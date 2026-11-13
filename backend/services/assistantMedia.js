import OpenAI from 'openai';
import { assistantMediaConfig } from '../config/anthropic.js';
import { cloudinaryConfig, isCloudinaryConfigured } from '../config/cloudinary.js';
import { logError } from './logger.js';
import { requireOpenAIKey, resolveKey } from './assistantConnections.js';
import { createMedia, failMedia, finishMedia, getMedia, setMediaJob } from './assistantStore.js';
import { signCloudinaryParams } from './uploads.js';

/**
 * Image and video generation for the Assistant. Claude cannot produce either, so these
 * go to a second provider (OpenAI); Claude calls them as tools or the user asks directly.
 */

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const MAX_DB_ASSET_BYTES = 40 * 1024 * 1024;
const VIDEO_TIMEOUT_MS = 30 * 60 * 1000;

/** Which kinds can be generated for this user right now (a provider key exists). */
export async function mediaAvailability(adminId) {
  const key = await resolveKey(adminId, 'openai').catch(() => null);
  return { image: Boolean(key), video: Boolean(key) };
}

async function uploadToCloudinary(buffer, mime, resourceType) {
  const { cloudName, apiKey, apiSecret } = cloudinaryConfig();
  const folder = assistantMediaConfig.cloudinaryFolder;
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { folder, timestamp };
  const body = new FormData();
  body.append('file', new Blob([buffer], { type: mime }), resourceType === 'video' ? 'clip.mp4' : 'image.png');
  body.append('api_key', apiKey);
  body.append('timestamp', String(timestamp));
  body.append('signature', signCloudinaryParams(params, apiSecret));
  body.append('folder', folder);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`, {
    method: 'POST',
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.secure_url) {
    throw new Error(data?.error?.message || `Cloudinary upload failed (${response.status})`);
  }
  return String(data.secure_url);
}

/** Cloudinary when configured, otherwise the bytes are kept in the database. */
async function storeAsset(mediaId, buffer, mime, resourceType) {
  if (isCloudinaryConfigured()) {
    try {
      const url = await uploadToCloudinary(buffer, mime, resourceType);
      return finishMedia(mediaId, { url, mime });
    } catch (error) {
      logError('assistant.media.cloudinary', error, { media_id: mediaId });
    }
  }
  if (buffer.length > MAX_DB_ASSET_BYTES) {
    throw new Error('The file is too large to store without Cloudinary configured.');
  }
  return finishMedia(mediaId, { mime, data: buffer });
}

function imageRequest(model, prompt, aspect) {
  const legacy = model.startsWith('dall-e');
  const sizes = legacy
    ? { square: '1024x1024', landscape: '1792x1024', portrait: '1024x1792' }
    : { square: '1024x1024', landscape: '1536x1024', portrait: '1024x1536' };
  return {
    model,
    prompt,
    n: 1,
    size: sizes[aspect] || sizes.square,
    // The older DALL·E models return a link unless asked for the bytes.
    ...(legacy ? { response_format: 'b64_json' } : { quality: assistantMediaConfig.imageQuality }),
  };
}

function providerMessage(error, fallback) {
  if (error instanceof OpenAI.APIError) return error.message || fallback;
  return error?.message || fallback;
}

/** Generate one image and return its media row (status "ready" or "failed"). */
export async function generateImage({ adminId, conversationId, prompt, aspect = 'square' }) {
  const { apiKey } = await requireOpenAIKey(adminId);
  const model = assistantMediaConfig.imageModel;
  const media = await createMedia({
    adminId,
    conversationId,
    kind: 'image',
    provider: 'openai',
    model,
    prompt,
    options: { aspect },
  });
  try {
    const client = new OpenAI({ apiKey, maxRetries: 1 });
    const result = await client.images.generate(imageRequest(model, prompt, aspect));
    const item = result?.data?.[0];
    let buffer;
    if (item?.b64_json) {
      buffer = Buffer.from(item.b64_json, 'base64');
    } else if (item?.url) {
      const download = await fetch(item.url);
      if (!download.ok) throw new Error(`Could not download the image (${download.status})`);
      buffer = Buffer.from(await download.arrayBuffer());
    } else {
      throw new Error('The image provider returned no image');
    }
    return await storeAsset(media.id, buffer, 'image/png', 'image');
  } catch (error) {
    logError('assistant.media.image', error, { media_id: media.id });
    return failMedia(media.id, providerMessage(error, 'Image generation failed'));
  }
}

async function openaiVideoFetch(apiKey, path, init = {}) {
  const response = await fetch(`${assistantMediaConfig.openaiBaseUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, ...(init.headers || {}) },
  });
  return response;
}

async function readProviderError(response) {
  const data = await response.json().catch(() => ({}));
  return data?.error?.message || `Video provider error (${response.status})`;
}

/** Start a video render. Returns immediately with a "pending" row; poll refreshMedia. */
export async function startVideo({ adminId, conversationId, prompt, seconds = 4, orientation = 'landscape' }) {
  const { apiKey } = await requireOpenAIKey(adminId);
  const model = assistantMediaConfig.videoModel;
  const media = await createMedia({
    adminId,
    conversationId,
    kind: 'video',
    provider: 'openai',
    model,
    prompt,
    options: { seconds, orientation },
  });
  try {
    const response = await openaiVideoFetch(apiKey, '/videos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        seconds: String(seconds),
        size: orientation === 'portrait' ? '720x1280' : '1280x720',
      }),
    });
    if (!response.ok) throw new Error(await readProviderError(response));
    const job = await response.json();
    if (!job?.id) throw new Error('The video provider did not return a job id');
    return await setMediaJob(media.id, job.id);
  } catch (error) {
    logError('assistant.media.video_start', error, { media_id: media.id });
    return failMedia(media.id, providerMessage(error, 'Video generation could not be started'));
  }
}

// Two polls arriving together must not both download and store the same clip.
const finalizing = new Map();

async function finalizeVideo(media, apiKey) {
  const status = await openaiVideoFetch(apiKey, `/videos/${encodeURIComponent(media.provider_job_id)}`);
  if (!status.ok) {
    return failMedia(media.id, await readProviderError(status));
  }
  const job = await status.json();
  if (job.status === 'failed' || job.status === 'cancelled') {
    return failMedia(media.id, job?.error?.message || 'The video could not be rendered');
  }
  if (job.status !== 'completed') return media;

  const content = await openaiVideoFetch(apiKey, `/videos/${encodeURIComponent(media.provider_job_id)}/content`);
  if (!content.ok) return failMedia(media.id, await readProviderError(content));
  const buffer = Buffer.from(await content.arrayBuffer());
  try {
    return await storeAsset(media.id, buffer, 'video/mp4', 'video');
  } catch (error) {
    return failMedia(media.id, error.message);
  }
}

/**
 * Current state of a media item. A pending video is checked against the provider here,
 * so rendering progresses as the browser polls — no background worker is needed.
 */
export async function refreshMedia(adminId, id) {
  const media = await getMedia(adminId, id);
  if (media.status !== 'pending' || media.kind !== 'video') return media;
  if (!media.provider_job_id) return media;
  if (Date.now() - new Date(media.created_at).getTime() > VIDEO_TIMEOUT_MS) {
    return failMedia(media.id, 'The video took too long to render');
  }
  if (finalizing.has(media.id)) return finalizing.get(media.id);

  const key = await resolveKey(adminId, 'openai');
  if (!key) throw httpError(409, 'The OpenAI key used for this video is no longer available');

  const work = finalizeVideo(media, key.apiKey)
    .catch((error) => {
      logError('assistant.media.video_poll', error, { media_id: media.id });
      return media;
    })
    .finally(() => finalizing.delete(media.id));
  finalizing.set(media.id, work);
  return work;
}

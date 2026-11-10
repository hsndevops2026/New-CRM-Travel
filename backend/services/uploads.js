import crypto from 'crypto';
import { cloudinaryConfig, isCloudinaryConfigured } from '../config/cloudinary.js';

export function signCloudinaryParams(params, apiSecret) {
  const toSign = Object.keys(params)
    .filter((key) => params[key] != null && params[key] !== '')
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return crypto.createHash('sha1').update(`${toSign}${apiSecret}`).digest('hex');
}

export function createCloudinarySignature() {
  if (!isCloudinaryConfigured()) {
    const error = new Error(
      'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.',
    );
    error.status = 503;
    throw error;
  }

  const { cloudName, apiKey, apiSecret, folder } = cloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { folder, timestamp };
  const signature = signCloudinaryParams(params, apiSecret);

  return {
    cloud_name: cloudName,
    api_key: apiKey,
    folder,
    timestamp,
    signature,
  };
}

/**
 * Server-side upload of a remote image URL into Cloudinary.
 * Returns the secure_url, or null when Cloudinary is not configured.
 */
export async function uploadRemoteImageToCloudinary(remoteUrl, { folder: folderOverride } = {}) {
  const source = String(remoteUrl || '').trim();
  if (!source) return null;
  if (!isCloudinaryConfigured()) return null;

  const { cloudName, apiKey, apiSecret, folder } = cloudinaryConfig();
  const targetFolder = String(folderOverride || folder || 'travel/quotes').trim() || 'travel/quotes';
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { folder: targetFolder, timestamp };
  const signature = signCloudinaryParams(params, apiSecret);

  const body = new FormData();
  body.append('file', source);
  body.append('api_key', apiKey);
  body.append('timestamp', String(timestamp));
  body.append('signature', signature);
  body.append('folder', targetFolder);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.secure_url) {
    const message = data?.error?.message || `Cloudinary upload failed (${response.status})`;
    const error = new Error(message);
    error.status = 502;
    throw error;
  }
  return String(data.secure_url);
}

import 'dotenv/config';

/** Models offered in the Assistant picker. The first entry is the default. */
export const ASSISTANT_MODELS = Object.freeze([
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Best all-round' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Fast, lower cost' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Fastest, cheapest' },
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2', note: 'Most capable, highest cost' },
]);

export const DEFAULT_ASSISTANT_MODEL = ASSISTANT_MODELS[0].id;

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
export const FALLBACK_CAPABLE_MODELS = Object.freeze([
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-fable-5-2',
]);

export const anthropicConfig = {
  // Optional deployment-wide key. Keys saved from the Assistant take priority over it.
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  maxTokens: Number(process.env.ASSISTANT_MAX_TOKENS) || 64000,
  // Each step is one model call; a turn that uses tools takes several.
  maxSteps: Number(process.env.ASSISTANT_MAX_STEPS) || 8,
  // Set to "off" to stop re-running declined requests on a fallback model.
  refusalFallback: String(process.env.ASSISTANT_REFUSAL_FALLBACK || 'on').toLowerCase() !== 'off',
};

export const assistantMediaConfig = {
  imageModel: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
  imageQuality: process.env.OPENAI_IMAGE_QUALITY || 'medium',
  videoModel: process.env.OPENAI_VIDEO_MODEL || 'sora-2',
  openaiBaseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
  cloudinaryFolder: process.env.CLOUDINARY_ASSISTANT_FOLDER || 'travel/assistant',
};

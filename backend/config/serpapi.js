export const serpApiConfig = {
  key: process.env.SERPAPI_KEY || '',
  baseUrl: process.env.SERPAPI_BASE_URL || 'https://serpapi.com/search.json',
  // Locale defaults applied to every engine unless a caller overrides them.
  hl: process.env.SERPAPI_HL || 'en',
  gl: process.env.SERPAPI_GL || 'us',
};

export function isSerpApiConfigured() {
  return Boolean(String(serpApiConfig.key || '').trim());
}

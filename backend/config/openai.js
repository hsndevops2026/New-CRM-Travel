import 'dotenv/config';

export const openaiConfig = {
  apiKey: process.env.OPENAI_API_KEY || '',
  model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  // Brochure / rate-sheet OCR. Measured on a 12-page, 11-hotel rate sheet: gpt-4.1-mini read
  // all 44 price cells correctly in every run and was faster than gpt-4o-mini, which
  // got ~7% of cells wrong (copying a neighbouring season's price). Wrong prices in a
  // quoting tool are costly, so the default favours accuracy.
  importModel: process.env.OPENAI_IMPORT_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini',
  // Speech-to-text for WhatsApp voice notes. gpt-4o-transcribe is more accurate on
  // Arabic and noisy audio; the mini model is cheaper and fine for clear speech.
  transcribeModel: process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe',
};

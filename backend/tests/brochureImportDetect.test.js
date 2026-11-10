import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  brochureMime,
  detectBrochureKind,
} from '../services/predefinedQuoteImports.js';

describe('brochure import file detection', () => {
  it('detects PDF, PNG, JPEG, WebP, and GIF from magic bytes', () => {
    assert.equal(detectBrochureKind(Buffer.from('%PDF-1.4 rest')), 'pdf');
    assert.equal(
      detectBrochureKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])),
      'png',
    );
    assert.equal(detectBrochureKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])), 'jpeg');
    assert.equal(
      detectBrochureKind(Buffer.from('RIFF\0\0\0\0WEBP....', 'binary')),
      'webp',
    );
    assert.equal(detectBrochureKind(Buffer.from('GIF89a............')), 'gif');
  });

  it('falls back to content-type or extension when magic bytes are ambiguous', () => {
    const opaque = Buffer.from('not-a-real-header!!!!');
    assert.equal(
      detectBrochureKind(opaque, { contentType: 'image/jpeg; charset=binary' }),
      'jpeg',
    );
    assert.equal(
      detectBrochureKind(opaque, { fileName: 'taba-rates.PNG' }),
      'png',
    );
  });

  it('rejects unsupported types', () => {
    assert.throws(
      () => detectBrochureKind(Buffer.from('PK\x03\x04docx')),
      (error) => error.status === 400,
    );
  });

  it('maps kinds to OpenAI-friendly MIME types', () => {
    assert.equal(brochureMime('pdf'), 'application/pdf');
    assert.equal(brochureMime('jpeg'), 'image/jpeg');
    assert.equal(brochureMime('png'), 'image/png');
  });
});

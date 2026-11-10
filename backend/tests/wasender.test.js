import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatRecipient, isGroupJid, normalizeGroupJid } from '../services/wasender.js';

describe('Wasender group recipients', () => {
  it('keeps WhatsApp group JIDs intact instead of treating them as phones', () => {
    assert.equal(isGroupJid('120363012345678901@g.us'), true);
    assert.equal(normalizeGroupJid('120363012345678901@g.us'), '120363012345678901@g.us');
    assert.equal(normalizeGroupJid('120363012345678901'), '120363012345678901@g.us');
    assert.equal(normalizeGroupJid('123456789-987654321@g.us'), '123456789-987654321@g.us');
    assert.equal(formatRecipient('120363012345678901@g.us'), '120363012345678901@g.us');
    assert.equal(formatRecipient('+971501234567'), '+971501234567');
    assert.equal(isGroupJid('+971501234567'), false);
    assert.equal(normalizeGroupJid('+971501234567'), null);
  });
});

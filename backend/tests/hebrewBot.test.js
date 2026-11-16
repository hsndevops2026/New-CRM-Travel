import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectMessageLanguage } from '../services/customerLanguage.js';
import { detectLanguage, processUserMessage } from '../services/openaiLead.js';
import { parsePackageDecision, searchLabel } from '../services/packageOffer.js';
import { getCustomerText } from '../services/customerTexts.js';

describe('Hebrew bot language detection', () => {
  it('detects Hebrew script and respects hints', () => {
    assert.equal(detectMessageLanguage('שלום, אני רוצה מלון'), 'he');
    assert.equal(detectLanguage('مرحبا'), 'ar');
    assert.equal(detectLanguage('hello'), 'en');
    assert.equal(detectLanguage('anything', 'he'), 'he');
  });

  it('greets and asks for hotel/flight in Hebrew', async () => {
    const welcome = await processUserMessage({ text: 'שלום', collected: {} });
    assert.equal(welcome.language, 'he');
    assert.match(welcome.reply, /ברוך הבא/);
    assert.match(welcome.reply, /מלון או טיסה/);

    const hotel = await processUserMessage({ text: 'מלון', collected: {}, languageHint: 'he' });
    assert.equal(hotel.language, 'he');
    assert.equal(hotel.collected.booking_type, 'hotel');
    assert.match(hotel.reply, /הזמנת מלון/);
  });

  it('parses Hebrew package yes/no and search labels', () => {
    assert.equal(parsePackageDecision('כן'), 'yes');
    assert.equal(parsePackageDecision('לא'), 'no');
    assert.equal(searchLabel('hotel', 'he'), 'מלונות');
    assert.equal(searchLabel('flight', 'he'), 'טיסות');
  });

  it('has Hebrew customer handover text', () => {
    assert.match(getCustomerText('humanHandover', 'he'), /צוות/);
  });
});

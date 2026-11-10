import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildReminderWhatsAppMessage,
  sendReminderWhatsApp,
} from '../services/reminders.js';

describe('reminder WhatsApp message', () => {
  it('includes greeting, text, and when', () => {
    const message = buildReminderWhatsAppMessage({
      contact_name: 'Ajay',
      text: 'Please share passport copy',
      remind_at: '2026-10-28T09:00:00.000Z',
    });
    assert.match(message, /^Hi Ajay,/);
    assert.match(message, /Reminder:/);
    assert.match(message, /Please share passport copy/);
    assert.match(message, /When:/);
  });

  it('works without a contact name', () => {
    const message = buildReminderWhatsAppMessage({
      text: 'Call back',
      remind_at: 'not-a-date',
    });
    assert.match(message, /^Hi,/);
    assert.match(message, /Call back/);
    assert.equal(message.includes('When:'), false);
  });

  it('skips send when contact has no phone', async () => {
    const calls = [];
    const result = await sendReminderWhatsApp(
      { id: 'r1', contact_id: 'c1', text: 'Hi', remind_at: new Date().toISOString() },
      { send: async (...args) => calls.push(args) },
    );
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'no_phone');
    assert.equal(calls.length, 0);
  });
});

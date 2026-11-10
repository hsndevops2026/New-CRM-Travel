import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, pool, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import { getAiHandover, hasArabic, isHumanRequest, pauseAi, resumeAi } from '../services/aiHandover.js';
import { handleIncomingLeadMessage } from '../controllers/whatsappLead.js';
import { getCustomerText } from '../services/customerTexts.js';

describe('human request detection', () => {
  it('recognises English and Arabic requests for a person', () => {
    for (const text of ['agent', 'I want to talk to a human please', 'بدي احكي مع حدا', 'أريد التحدث مع موظف', 'موظف']) {
      assert.equal(isHumanRequest(text), true, text);
    }
  });

  it('ignores ordinary trip messages', () => {
    for (const text of ['Hotel in Dubai 12-15 March', 'فندق في اسطنبول لشخصين', '2 adults 1 child', '']) {
      assert.equal(isHumanRequest(text), false, text);
    }
  });

  it('detects Arabic script', () => {
    assert.equal(hasArabic('مرحبا'), true);
    assert.equal(hasArabic('hello'), false);
  });
});

describe('AI handover', () => {
  const tag = String(Date.now()).slice(-7);
  const phone = `97259${tag}`;
  const phone2 = `97258${tag}`;

  before(async () => {
    await pingDb();
    await runMigrations();
  });

  after(async () => {
    await query(`DELETE FROM messages WHERE from_number = ANY($1) OR to_number = ANY($1)`, [[phone, phone2]]);
    await query(`DELETE FROM conversations WHERE phone = ANY($1)`, [[phone, phone2]]);
    await query(`DELETE FROM ai_handover WHERE phone = ANY($1)`, [[phone, phone2]]);
    await pool.end();
  });

  it('pauses, resumes and auto-resumes after the configured hours', async () => {
    assert.equal((await getAiHandover(phone)).paused, false);
    await pauseAi(phone, { reason: 'manual' });
    assert.equal((await getAiHandover(phone)).paused, true);
    await resumeAi(phone);
    assert.equal((await getAiHandover(phone)).paused, false);

    await pauseAi(phone, { reason: 'manual' });
    const later = new Date(Date.now() + 5 * 3_600_000);
    assert.equal((await getAiHandover(phone, { now: later, env: {} })).paused, true, 'no auto resume when unset');
    const resumed = await getAiHandover(phone, { now: later, env: { AI_AUTO_RESUME_HOURS: '4' } });
    assert.equal(resumed.paused, false);
    assert.equal(resumed.auto_resumed, true);
  });

  it('stores the message but sends no bot reply while paused', async () => {
    await pauseAi(phone, { reason: 'agent_reply' });
    const result = await handleIncomingLeadMessage({ from: phone, text: 'Hotel in Dubai please', skipWhatsApp: true });
    assert.equal(result.ai_paused, true);
    assert.equal(result.reply, '');
    const { rows } = await query(
      `SELECT body FROM messages WHERE from_number = $1 AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1`,
      [phone],
    );
    assert.equal(rows[0]?.body, 'Hotel in Dubai please');
  });

  it('pauses and answers in Arabic when the customer asks for a person', async () => {
    const result = await handleIncomingLeadMessage({ from: phone2, text: 'بدي احكي مع حدا', skipWhatsApp: true });
    assert.equal(result.human_requested, true);
    assert.equal(result.reply, getCustomerText('humanHandover', 'ar'));
    assert.equal((await getAiHandover(phone2)).paused, true);
  });
});

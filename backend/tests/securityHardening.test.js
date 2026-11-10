import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { productionConfigProblems } from '../config/productionGuard.js';
import { requireRole } from '../middleware/requireRole.js';
import { verifyWebhookSignature } from '../routes/whatsapp.js';

function runRole(admin, ...roles) {
  let status = null;
  let passed = false;
  const res = { status(code) { status = code; return { json() {} }; } };
  requireRole(...roles)({ admin }, res, () => { passed = true; });
  return { status, passed };
}

describe('production config guard', () => {
  it('ignores missing secrets outside production', () => {
    assert.deepEqual(productionConfigProblems({ NODE_ENV: 'development' }), []);
  });

  it('refuses production without login secrets', () => {
    const problems = productionConfigProblems({ NODE_ENV: 'production' });
    assert.equal(problems.length, 2);
  });

  it('accepts SESSION_SECRET in place of both JWT secrets', () => {
    assert.deepEqual(productionConfigProblems({ NODE_ENV: 'production', SESSION_SECRET: 's' }), []);
  });

  it('refuses identical access and refresh secrets', () => {
    const problems = productionConfigProblems({
      NODE_ENV: 'production', JWT_ACCESS_SECRET: 'same', JWT_REFRESH_SECRET: 'same',
    });
    assert.ok(problems.some((p) => p.includes('different')));
  });

  it('requires a webhook secret when WhatsApp is enabled', () => {
    const problems = productionConfigProblems({
      NODE_ENV: 'production', SESSION_SECRET: 's', WASENDER_API_KEY: 'k',
    });
    assert.ok(problems.some((p) => p.includes('WASENDER_WEBHOOK_SECRET')));
  });
});

describe('WhatsApp webhook signature', () => {
  const req = (sig) => ({ headers: sig === undefined ? {} : { 'x-webhook-signature': sig } });

  it('rejects unsigned requests in production when no secret is configured', () => {
    assert.equal(verifyWebhookSignature(req(), { secret: '', production: true }), false);
  });

  it('allows unsigned requests only in development without a secret', () => {
    assert.equal(verifyWebhookSignature(req(), { secret: '', production: false }), true);
  });

  it('accepts the right signature and rejects wrong or missing ones', () => {
    assert.equal(verifyWebhookSignature(req('abc123'), { secret: 'abc123', production: true }), true);
    assert.equal(verifyWebhookSignature(req('abc124'), { secret: 'abc123', production: true }), false);
    assert.equal(verifyWebhookSignature(req('abc'), { secret: 'abc123', production: true }), false);
    assert.equal(verifyWebhookSignature(req(), { secret: 'abc123', production: true }), false);
  });
});

describe('requireRole', () => {
  it('denies an account with no role', () => {
    assert.deepEqual(runRole({ id: 'x' }, 'admin'), { status: 403, passed: false });
    assert.deepEqual(runRole(undefined, 'admin'), { status: 403, passed: false });
  });

  it('allows a listed role and denies others', () => {
    assert.equal(runRole({ role: 'admin' }, 'admin').passed, true);
    assert.equal(runRole({ role: 'agent' }, 'admin').status, 403);
  });
});

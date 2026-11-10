import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../createApp.js';

describe('public quote rate limit', () => {
  let server;
  let base;

  before(async () => {
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  it('returns JSON 429 after 120 requests a minute and sets security headers', async () => {
    let last;
    for (let i = 0; i < 121; i += 1) {
      last = await fetch(`${base}/api/q/not-a-real-token`);
      if (i < 120) assert.notEqual(last.status, 429, `request ${i + 1} should not be limited`);
    }
    assert.equal(last.status, 429);
    assert.match((await last.json()).error, /Too many requests/);
    assert.equal(last.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(last.headers.get('x-powered-by'), null);
  });
});

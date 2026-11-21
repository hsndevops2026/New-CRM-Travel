import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { widgetBaseUrl } from '../routes/webchatSettings.js';
import { webchatTestPage } from '../routes/webchat.js';

const req = (host, protocol = 'https', headers = {}) => ({
  protocol,
  query: {},
  get: (name) => (name.toLowerCase() === 'host' ? host : headers[name.toLowerCase()]),
});

/** The backend can live under a path behind a proxy (e.g. https://api.agency.com/travel). */
describe('website chat public address', () => {
  it('keeps the path the backend is served under', () => {
    assert.equal(widgetBaseUrl(req('api.agency.com'), { BACKEND_URL: 'https://api.agency.com/travel/' }), 'https://api.agency.com/travel');
    assert.equal(widgetBaseUrl(req('api.agency.com'), { WEBCHAT_PUBLIC_URL: 'https://chat.agency.com', BACKEND_URL: 'https://b.test' }), 'https://chat.agency.com');
    assert.equal(widgetBaseUrl(req('api.agency.com', 'https', { 'x-forwarded-prefix': '/travel' }), {}), 'https://api.agency.com/travel');
  });

  it('never hands a live site a localhost address', () => {
    assert.equal(widgetBaseUrl(req('api.agency.com'), { BACKEND_URL: 'http://localhost:3000' }), 'https://api.agency.com');
    assert.equal(widgetBaseUrl(req('localhost:3000', 'http'), { BACKEND_URL: 'http://localhost:3000' }), 'http://localhost:3000');
  });

  it('the test page loads the script next to itself, so a path prefix is kept', () => {
    let html = '';
    webchatTestPage({ query: { lang: 'en' } }, { setHeader() {}, type() { return { send: (body) => { html = body; } }; } });
    assert.match(html, /<script src="webchat\.js"/);
  });

  it('the widget calls the API next to where its script was loaded from', () => {
    const js = readFileSync(new URL('../public/webchat.js', import.meta.url), 'utf8');
    assert.match(js, /replace\(\/\\\/\[\^\/\]\*\$\/, ''\)/);
  });

  it('the Docker image includes the widget script', () => {
    const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
    assert.match(dockerfile, /COPY public \.\/public/);
  });
});

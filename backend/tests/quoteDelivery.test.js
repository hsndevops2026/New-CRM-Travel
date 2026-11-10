import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveFrontendBaseUrl } from '../services/quoteDelivery.js';

describe('resolveFrontendBaseUrl', () => {
  it('prefers FRONTEND_URL over CORS_ORIGINS', () => {
    assert.equal(
      resolveFrontendBaseUrl({
        frontendUrl: 'https://travel.example.com/',
        corsOrigins: 'http://localhost:5173,https://other.example.com',
      }),
      'https://travel.example.com',
    );
  });

  it('skips localhost entries in CORS_ORIGINS', () => {
    assert.equal(
      resolveFrontendBaseUrl({
        frontendUrl: '',
        corsOrigins: 'http://localhost:5173,https://travel-kappa-navy.vercel.app',
      }),
      'https://travel-kappa-navy.vercel.app',
    );
  });

  it('falls back to localhost only when no public origin exists', () => {
    assert.equal(
      resolveFrontendBaseUrl({
        frontendUrl: '',
        corsOrigins: 'http://localhost:5173',
      }),
      'http://localhost:5173',
    );
  });
});

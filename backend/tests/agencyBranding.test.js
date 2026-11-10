import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pool } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import {
  getAgencySettings,
  normalizeAgencySettings,
  publicAgencySettings,
  updateAgencySettings,
} from '../services/agencySettings.js';
import { brandedFooterText, pdfSafeLogoUrl } from '../services/pdfBranding.js';
import { buildVersionPdfBuffer } from '../services/quotationPdf.js';

describe('agency branding', () => {
  let original;

  before(async () => {
    await runMigrations();
    original = await getAgencySettings();
  });

  after(async () => {
    if (original) await updateAgencySettings(publicAgencySettings(original));
    await pool.end();
  });

  it('validates colors, templates, contact details, and URLs', () => {
    assert.throws(
      () => normalizeAgencySettings({ primary_color: 'teal' }, { partial: true }),
      /6-digit hex/i,
    );
    assert.throws(
      () => normalizeAgencySettings({ quotation_template: 'luxury' }, { partial: true }),
      /classic or modern/i,
    );
    assert.throws(
      () => normalizeAgencySettings({ logo_url: 'javascript:alert(1)' }, { partial: true }),
      /http or https/i,
    );
    assert.equal(
      normalizeAgencySettings({ primary_color: '#ABCDEF' }, { partial: true }).primary_color,
      '#abcdef',
    );
    assert.equal(
      pdfSafeLogoUrl('https://res.cloudinary.com/demo/image/upload/v1/logo.webp'),
      'https://res.cloudinary.com/demo/image/upload/f_png/v1/logo.webp',
    );
  });

  it('persists one deployment-wide profile and exposes only public fields', async () => {
    const updated = await updateAgencySettings({
      agency_name: 'North Star Travel',
      primary_color: '#123456',
      quotation_template: 'modern',
      email: 'quotes@northstar.example',
    });
    assert.equal(updated.agency_name, 'North Star Travel');
    assert.equal(updated.quotation_template, 'modern');
    const publicValue = publicAgencySettings(updated);
    assert.equal(publicValue.email, 'quotes@northstar.example');
    assert.equal(Object.hasOwn(publicValue, 'agency_slug'), false);
  });

  it('renders a branded customer quotation PDF', async () => {
    const agency = {
      agency_name: 'North Star Travel',
      primary_color: '#123456',
      quotation_template: 'modern',
      quotation_footer: 'Designed around your journey.',
      email: 'quotes@northstar.example',
    };
    assert.match(brandedFooterText(agency), /North Star Travel/);
    const pdf = await buildVersionPdfBuffer({
      title: 'Kerala Escape', version_number: 2, currency: 'INR',
      lead: { destination: 'Kerala', travel_date: '2027-01-10', nights: 4, adults_count: 2 },
      items: [{ label: 'Lagoon Resort', description: 'Four nights with breakfast', meta: {} }],
      pricing: { selling_price: 125000 },
      notes: 'Subject to final room confirmation.',
    }, agency);
    assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
    assert.ok(pdf.length > 1500);
  });
});

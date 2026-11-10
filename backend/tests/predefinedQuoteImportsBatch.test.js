import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, pool, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import {
  buildOfferPrompt,
  EXTRACTION_VERSION,
  extractBrochurePackages,
  importPredefinedQuoteBrochure,
  mapWithConcurrency,
  normalizeOutline,
  normalizeRoundTripFlightPrices,
} from '../services/predefinedQuoteImports.js';

/* ------------------------------------------------------------------ *
 * Fake OpenAI: answers the outline pass and the per-offer pass.
 * ------------------------------------------------------------------ */

function emptyItem(overrides = {}) {
  return {
    item_type: 'hotel', title: null, description: null, image_url: null, price: null,
    currency: 'USD', hotel_name: null, category: null, board_name: null, room_name: null,
    check_in: null, check_out: null, nights: null, airline: null, flight_number: null,
    departure_airport: null, arrival_airport: null, departure_city: null, arrival_city: null,
    departure_time: null, arrival_time: null, duration: null, stops: null, direction: null,
    ...overrides,
  };
}

function packageFor(name, price) {
  return {
    package: {
      title: name, origin: null, destination: 'Antalya', description: null,
      cover_image_url: null, currency: 'USD', total_price: null, notes: null,
      travel_date: null, return_date: null, nights: null, adults_count: 2, children_count: 0,
      items: [emptyItem({ hotel_name: name, price })],
    },
    warnings: [],
  };
}

/**
 * @param {{ offers: object[], failFor?: string[], incompleteFor?: string[], delayMs?: number }} opts
 */
function fakeAi({ offers, failFor = [], incompleteFor = [], delayMs = 0 }) {
  const calls = { outline: 0, packages: [], inFlight: 0, maxInFlight: 0 };
  return {
    calls,
    responses: {
      create: async (request) => {
        const format = request.text.format.name;
        const prompt = request.input[0].content.find((part) => part.type === 'input_text').text;

        if (format === 'brochure_outline') {
          calls.outline += 1;
          return { status: 'completed', output_text: JSON.stringify({ offers, warnings: [] }) };
        }

        const name = (prompt.match(/- Name: (.+)/) || [])[1] || 'WHOLE DOCUMENT';
        calls.packages.push(name);
        calls.inFlight += 1;
        calls.maxInFlight = Math.max(calls.maxInFlight, calls.inFlight);
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
        calls.inFlight -= 1;

        if (failFor.includes(name)) throw new Error('model exploded');
        if (incompleteFor.includes(name)) {
          return { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output_text: '{"package":{"ti' };
        }
        return { status: 'completed', output_text: JSON.stringify(packageFor(name, 100)) };
      },
    },
  };
}

const three = [
  { name: 'Rixos Premium Belek', kind: 'hotel', destination: 'Belek', pages: '2' },
  { name: 'Maxx Royal Kemer', kind: 'hotel', destination: 'Kemer', pages: '3-4' },
  { name: 'Titanic Beach Lara', kind: 'hotel', destination: 'Lara', pages: '5' },
];

const pdfBytes = () => Buffer.from(`%PDF-1.4\n% ${crypto.randomUUID()}\n`);

/* ------------------------------------------------------------------ *
 * Pure helpers
 * ------------------------------------------------------------------ */

describe('normalizeOutline', () => {
  it('keeps offers in document order', () => {
    const { offers } = normalizeOutline({ offers: three, warnings: [] });
    assert.deepEqual(offers.map((offer) => offer.name), three.map((offer) => offer.name));
  });

  it('merges the same hotel listed twice and combines its pages', () => {
    const { offers } = normalizeOutline({
      offers: [
        { name: 'Rixos Premium Belek', kind: 'hotel', destination: null, pages: '2' },
        { name: 'rixos  premium-belek', kind: 'hotel', destination: null, pages: '11' },
        { name: 'Other Hotel', kind: 'hotel', destination: null, pages: '3' },
      ],
      warnings: [],
    });
    assert.equal(offers.length, 2);
    assert.equal(offers[0].pages, '2, 11');
  });

  it('drops entries without a usable name', () => {
    const { offers } = normalizeOutline({
      offers: [
        { name: '   ', kind: 'hotel', destination: null, pages: '1' },
        { name: '---', kind: 'hotel', destination: null, pages: '1' },
        { name: 'Real Hotel', kind: 'hotel', destination: null, pages: '2' },
      ],
      warnings: [],
    });
    assert.deepEqual(offers.map((offer) => offer.name), ['Real Hotel']);
  });

  it('caps the number of offers so a bad read cannot fan out into hundreds of calls', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      name: `Hotel ${i}`, kind: 'hotel', destination: null, pages: String(i),
    }));
    const { offers, warnings } = normalizeOutline({ offers: many, warnings: [] }, { maxOffers: 4 });
    assert.equal(offers.length, 4);
    assert.match(warnings.join(' '), /10 offers; only the first 4/);
  });

  it('treats an unknown kind as a package and tolerates a malformed outline', () => {
    const { offers } = normalizeOutline({
      offers: [{ name: 'X', kind: 'cruise', destination: null, pages: '1' }],
    });
    assert.equal(offers[0].kind, 'package');
    assert.deepEqual(normalizeOutline(null), { offers: [], warnings: [] });
  });

  it('does not collapse distinct hotels whose names share a prefix', () => {
    const { offers } = normalizeOutline({
      offers: [
        { name: 'Sunis Efes', kind: 'hotel', destination: null, pages: '1' },
        { name: 'Sunis Efes Royal Palace', kind: 'hotel', destination: null, pages: '2' },
      ],
    });
    assert.equal(offers.length, 2);
  });
});

describe('buildOfferPrompt', () => {
  it('narrows extraction to the one offer, with its pages and destination', () => {
    const prompt = buildOfferPrompt(three[1]);
    assert.match(prompt, /Extract ONLY the offer below/);
    assert.match(prompt, /- Name: Maxx Royal Kemer/);
    assert.match(prompt, /- Destination: Kemer/);
    assert.match(prompt, /page\(s\): 3-4/);
  });

  it('is the plain whole-document prompt when there is no offer', () => {
    assert.doesNotMatch(buildOfferPrompt(null), /FOCUS/);
  });

  it('tells the model not to translate or invent Arabic', () => {
    assert.match(buildOfferPrompt(null), /never translate names or add Arabic text/);
  });

  it('requires one item per printed period and the DBL column', () => {
    const prompt = buildOfferPrompt(null);
    assert.match(prompt, /Never collapse several periods into one item/);
    assert.match(prompt, /not the SGL column when a DBL column exists/);
  });

  it('tells the model to count a round-trip fare only once', () => {
    const prompt = buildOfferPrompt(null);
    assert.match(prompt, /fare on the outbound item only/);
    assert.match(prompt, /490 and 550 have total_price 1040, not 2080/);
  });
});

describe('normalizeRoundTripFlightPrices', () => {
  const leg = (overrides) => emptyItem({ item_type: 'flight', airline: 'Royal Jordanian', ...overrides });

  it('counts each advertised round-trip option once', () => {
    const normalized = normalizeRoundTripFlightPrices({
      title: 'Amman → Istanbul → Amman',
      total_price: null,
      items: [
        leg({ direction: 'outbound', departure_city: 'Amman', arrival_city: 'Istanbul', departure_time: '20:00', price: 490 }),
        leg({ direction: 'return', departure_city: 'Istanbul', arrival_city: 'Amman', departure_time: '22:30', price: 490 }),
        leg({ direction: 'outbound', departure_city: 'Amman', arrival_city: 'Istanbul', departure_time: '18:00', price: 550 }),
        leg({ direction: 'return', departure_city: 'Istanbul', arrival_city: 'Amman', departure_time: '21:30', price: 550 }),
      ],
    });

    assert.equal(normalized.total_price, 1040);
    assert.deepEqual(normalized.items.map((item) => item.price), [490, null, 550, null]);
  });

  it('does not combine different per-leg prices', () => {
    const normalized = normalizeRoundTripFlightPrices({
      total_price: null,
      items: [
        leg({ direction: 'outbound', departure_city: 'Amman', arrival_city: 'Istanbul', price: 490 }),
        leg({ direction: 'return', departure_city: 'Istanbul', arrival_city: 'Amman', price: 550 }),
      ],
    });

    assert.equal(normalized.total_price, null);
    assert.deepEqual(normalized.items.map((item) => item.price), [490, 550]);
  });
});

describe('mapWithConcurrency', () => {
  it('never runs more than `limit` at once and keeps input order', async () => {
    let active = 0;
    let peak = 0;
    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return n * 10;
    });
    assert.equal(peak, 2);
    assert.deepEqual(results.map((r) => r.value), [10, 20, 30, 40, 50, 60]);
  });

  it('captures a failure in its own slot instead of rejecting the batch', async () => {
    const results = await mapWithConcurrency(['a', 'b', 'c'], 3, async (x) => {
      if (x === 'b') throw new Error('nope');
      return x;
    });
    assert.deepEqual(results.map((r) => r.ok), [true, false, true]);
    assert.equal(results[1].error.message, 'nope');
  });

  it('handles an empty list', async () => {
    assert.deepEqual(await mapWithConcurrency([], 4, async () => 1), []);
  });
});

/* ------------------------------------------------------------------ *
 * Orchestration (fake AI, no database)
 * ------------------------------------------------------------------ */

describe('extractBrochurePackages', () => {
  it('returns one package per offer, in document order — not one package for the file', async () => {
    const ai = fakeAi({ offers: three });
    const out = await extractBrochurePackages({ buffer: pdfBytes(), kind: 'pdf', fileName: 'r.pdf', ai });

    assert.equal(out.packages.length, 3);
    assert.deepEqual(out.packages.map((p) => p.payload.title), three.map((o) => o.name));
    assert.equal(ai.calls.outline, 1);
    // Each offer got its own focused call.
    assert.deepEqual([...ai.calls.packages].sort(), three.map((o) => o.name).sort());
  });

  it('keeps the offer (with its pages) next to each package', async () => {
    const out = await extractBrochurePackages({
      buffer: pdfBytes(), kind: 'pdf', fileName: 'r.pdf', ai: fakeAi({ offers: three }),
    });
    assert.equal(out.packages[1].offer.pages, '3-4');
  });

  it('survives one failing offer: the rest are returned and the failure is a warning', async () => {
    const ai = fakeAi({ offers: three, failFor: ['Maxx Royal Kemer'] });
    const out = await extractBrochurePackages({ buffer: pdfBytes(), kind: 'pdf', fileName: 'r.pdf', ai });

    assert.deepEqual(out.packages.map((p) => p.payload.title), ['Rixos Premium Belek', 'Titanic Beach Lara']);
    assert.match(out.warnings.join(' '), /Could not extract Maxx Royal Kemer \(pages 3-4\)/);
    // It was retried once before giving up.
    assert.equal(ai.calls.packages.filter((n) => n === 'Maxx Royal Kemer').length, 2);
  });

  it('treats a cut-off (incomplete) response as a failure, not as broken JSON', async () => {
    const ai = fakeAi({ offers: three, incompleteFor: ['Titanic Beach Lara'] });
    const out = await extractBrochurePackages({ buffer: pdfBytes(), kind: 'pdf', fileName: 'r.pdf', ai });
    assert.equal(out.packages.length, 2);
    assert.match(out.warnings.join(' '), /cut off \(max_output_tokens\)/);
  });

  it('throws when every offer fails', async () => {
    const ai = fakeAi({ offers: three, failFor: three.map((o) => o.name) });
    await assert.rejects(
      () => extractBrochurePackages({ buffer: pdfBytes(), kind: 'pdf', fileName: 'r.pdf', ai }),
      /Could not extract/,
    );
  });

  it('falls back to a single whole-document package when the outline finds nothing', async () => {
    const ai = fakeAi({ offers: [] });
    const out = await extractBrochurePackages({ buffer: pdfBytes(), kind: 'pdf', fileName: 'flyer.pdf', ai });

    assert.equal(out.packages.length, 1);
    assert.equal(out.packages[0].offer, null);
    assert.match(out.warnings.join(' '), /extracted it as a single package/);
    assert.deepEqual(ai.calls.packages, ['WHOLE DOCUMENT']);
  });

  it('limits parallel model calls', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      name: `Hotel ${i}`, kind: 'hotel', destination: null, pages: String(i + 2),
    }));
    const ai = fakeAi({ offers: many, delayMs: 15 });
    const out = await extractBrochurePackages({
      buffer: pdfBytes(), kind: 'pdf', fileName: 'r.pdf', ai, concurrency: 3,
    });
    assert.equal(out.packages.length, 8);
    assert.equal(ai.calls.maxInFlight, 3);
  });

  it('sends the PDF as a file input and images as image input', async () => {
    const seen = [];
    const ai = {
      responses: {
        create: async (request) => {
          seen.push(request.input[0].content[0].type);
          return { status: 'completed', output_text: JSON.stringify({ offers: [], warnings: [] }) };
        },
      },
    };
    await extractBrochurePackages({ buffer: pdfBytes(), kind: 'pdf', fileName: 'a.pdf', ai }).catch(() => {});
    await extractBrochurePackages({ buffer: Buffer.from('x'), kind: 'png', fileName: 'a.png', ai }).catch(() => {});
    assert.ok(seen.includes('input_file'));
    assert.ok(seen.includes('input_image'));
  });
});

/* ------------------------------------------------------------------ *
 * importPredefinedQuoteBrochure (fake AI, real Postgres)
 * ------------------------------------------------------------------ */

describe('importPredefinedQuoteBrochure', () => {
  const hashes = [];
  const track = (buffer) => {
    hashes.push(crypto.createHash('sha256').update(buffer).digest('hex'));
    return buffer;
  };

  before(async () => {
    await pingDb();
    await runMigrations();
  });

  after(async () => {
    if (hashes.length) {
      await query('DELETE FROM predefined_quote_imports WHERE file_hash = ANY($1)', [hashes]);
    }
    await pool.end();
  });

  it('creates one reviewable import record per hotel, grouped as a batch', async () => {
    const buffer = track(pdfBytes());
    const result = await importPredefinedQuoteBrochure({
      buffer, fileName: 'ratesheet.pdf', contentType: 'application/pdf', ai: fakeAi({ offers: three }),
    });

    assert.equal(result.duplicate, false);
    assert.equal(result.importRecords.length, 3);
    assert.deepEqual(
      result.importRecords.map((r) => r.extracted_payload.title),
      three.map((o) => o.name),
    );
    assert.deepEqual(result.importRecords.map((r) => r.batch_index), [0, 1, 2]);
    assert.ok(result.importRecords.every((r) => r.batch_total === 3));
    assert.ok(result.importRecords.every((r) => r.status === 'needs_review'));
    assert.ok(result.importRecords.every((r) => r.extraction_version === EXTRACTION_VERSION));
    assert.equal(new Set(result.importRecords.map((r) => r.batch_id)).size, 1);
    assert.deepEqual(result.importRecords.map((r) => r.source_pages), ['2', '3-4', '5']);
    assert.match(result.importRecords[1].warnings.join(' '), /Package 2 of 3/);
    // First package is also returned as `importRecord` for older callers.
    assert.equal(result.importRecord.id, result.importRecords[0].id);
  });

  it('lists a batch together and in document order', async () => {
    const buffer = track(pdfBytes());
    await importPredefinedQuoteBrochure({
      buffer, fileName: 'order.pdf', contentType: 'application/pdf', ai: fakeAi({ offers: three }),
    });
    const { listPredefinedQuoteImports } = await import('../services/predefinedQuoteImports.js');
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const listed = (await listPredefinedQuoteImports({ status: 'needs_review', limit: 200 }))
      .filter((r) => r.file_hash === hash);
    assert.deepEqual(listed.map((r) => r.batch_index), [0, 1, 2]);
  });

  it('returns the existing packages for a re-upload without calling the AI again', async () => {
    const buffer = track(pdfBytes());
    const first = await importPredefinedQuoteBrochure({
      buffer, fileName: 'again.pdf', contentType: 'application/pdf', ai: fakeAi({ offers: three }),
    });
    const spy = fakeAi({ offers: three });
    const second = await importPredefinedQuoteBrochure({
      buffer, fileName: 'again.pdf', contentType: 'application/pdf', ai: spy,
    });

    assert.equal(second.duplicate, true);
    assert.deepEqual(second.importRecords.map((r) => r.id), first.importRecords.map((r) => r.id));
    assert.equal(spy.calls.outline, 0);
    assert.deepEqual(spy.calls.packages, []);
  });

  it('reads the file again on request, and retires the unreviewed packages it replaces', async () => {
    const buffer = track(pdfBytes());
    const first = await importPredefinedQuoteBrochure({
      buffer, fileName: 'redo.pdf', contentType: 'application/pdf', ai: fakeAi({ offers: three }),
    });
    const spy = fakeAi({ offers: three });
    const again = await importPredefinedQuoteBrochure({
      buffer, fileName: 'redo.pdf', contentType: 'application/pdf', ai: spy, reextract: true,
    });

    assert.equal(again.duplicate, false);
    assert.equal(again.replaced, 3);
    assert.equal(spy.calls.outline, 1, 'the AI really ran again');
    assert.equal(again.importRecords.length, 3);
    assert.ok(again.importRecords.every((r) => !first.importRecords.some((old) => old.id === r.id)));

    // Only the new read is waiting for review — no doubled-up packages.
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const rows = await query('SELECT id, status FROM predefined_quote_imports WHERE file_hash = $1', [hash]);
    assert.equal(rows.rows.filter((r) => r.status === 'needs_review').length, 3);
    assert.deepEqual(
      rows.rows.filter((r) => r.status === 'rejected').map((r) => r.id).sort(),
      first.importRecords.map((r) => r.id).sort(),
    );
  });

  it('leaves packages that were already approved alone when it re-reads', async () => {
    const buffer = track(pdfBytes());
    const first = await importPredefinedQuoteBrochure({
      buffer, fileName: 'keep.pdf', contentType: 'application/pdf', ai: fakeAi({ offers: three }),
    });
    await query(`UPDATE predefined_quote_imports SET status = 'approved' WHERE id = $1`, [first.importRecords[0].id]);

    const again = await importPredefinedQuoteBrochure({
      buffer, fileName: 'keep.pdf', contentType: 'application/pdf', ai: fakeAi({ offers: three }), reextract: true,
    });
    assert.equal(again.replaced, 2, 'only the two still waiting are replaced');
    const kept = await query('SELECT status FROM predefined_quote_imports WHERE id = $1', [first.importRecords[0].id]);
    assert.equal(kept.rows[0].status, 'approved');
  });

  it('keeps the old packages if the re-read fails', async () => {
    const buffer = track(pdfBytes());
    const first = await importPredefinedQuoteBrochure({
      buffer, fileName: 'fragile.pdf', contentType: 'application/pdf', ai: fakeAi({ offers: three }),
    });
    await assert.rejects(
      () => importPredefinedQuoteBrochure({
        buffer, fileName: 'fragile.pdf', contentType: 'application/pdf', reextract: true,
        ai: fakeAi({ offers: three, failFor: three.map((o) => o.name) }),
      }),
      /Could not extract this brochure/,
    );
    const rows = await query(
      `SELECT status FROM predefined_quote_imports WHERE id = ANY($1::uuid[])`,
      [first.importRecords.map((r) => r.id)],
    );
    assert.ok(rows.rows.every((r) => r.status === 'needs_review'), 'the reviewer still has the first read');
  });

  it('does not read twice at once, even when re-reading', async () => {
    const buffer = track(pdfBytes());
    await importPredefinedQuoteBrochure({
      buffer, fileName: 'busy.pdf', contentType: 'application/pdf', ai: fakeAi({ offers: three }),
    });
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    await query(`UPDATE predefined_quote_imports SET status = 'processing' WHERE file_hash = $1 AND batch_index = 0`, [hash]);
    const spy = fakeAi({ offers: three });
    await assert.rejects(
      () => importPredefinedQuoteBrochure({
        buffer, fileName: 'busy.pdf', contentType: 'application/pdf', ai: spy, reextract: true,
      }),
      (error) => error.status === 409,
    );
    assert.equal(spy.calls.outline, 0);
  });

  it('only re-reads when asked: the same upload without the flag is still a duplicate', async () => {
    const buffer = track(pdfBytes());
    await importPredefinedQuoteBrochure({
      buffer, fileName: 'flag.pdf', contentType: 'application/pdf', ai: fakeAi({ offers: three }),
    });
    const again = await importPredefinedQuoteBrochure({
      buffer, fileName: 'flag.pdf', contentType: 'application/pdf', ai: fakeAi({ offers: three }),
    });
    assert.equal(again.duplicate, true);
    assert.equal(again.replaced, undefined);
  });

  it('extracts once when the same file is uploaded twice at the same moment', async () => {
    const buffer = track(pdfBytes());
    const spy = fakeAi({ offers: three, delayMs: 25 });
    // Open two connections first. Otherwise the second request waits to connect, the
    // first commits in the meantime, and the race this test is about never happens.
    const warm = await Promise.all([pool.connect(), pool.connect()]);
    warm.forEach((client) => client.release());
    const [a, b] = await Promise.all([
      importPredefinedQuoteBrochure({ buffer, fileName: 'race.pdf', contentType: 'application/pdf', ai: spy }),
      importPredefinedQuoteBrochure({ buffer, fileName: 'race.pdf', contentType: 'application/pdf', ai: spy }),
    ]);

    assert.equal(spy.calls.outline, 1);
    assert.equal([a, b].filter((r) => r.duplicate).length, 1);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const rows = await query('SELECT 1 FROM predefined_quote_imports WHERE file_hash = $1', [hash]);
    assert.equal(rows.rowCount, 3);
  });

  it('serialises on the file hash: a held lock blocks the import until released', async () => {
    // Deterministic check of the mechanism behind the race test above: the
    // lookup-then-insert must run under a per-file advisory lock.
    const buffer = track(pdfBytes());
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const holder = await pool.connect();
    try {
      await holder.query('SELECT pg_advisory_lock(hashtext($1))', [hash]);

      const spy = fakeAi({ offers: three });
      let finished = false;
      const pending = importPredefinedQuoteBrochure({
        buffer, fileName: 'locked.pdf', contentType: 'application/pdf', ai: spy,
      }).then((result) => {
        finished = true;
        return result;
      });

      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(finished, false, 'import must wait while another upload holds the file lock');
      assert.equal(spy.calls.outline, 0);

      await holder.query('SELECT pg_advisory_unlock(hashtext($1))', [hash]);
      const result = await pending;
      assert.equal(result.importRecords.length, 3);
    } finally {
      holder.release();
    }
  });

  it('re-extracts a brochure that the old single-package extractor already imported', async () => {
    // This is the reported bug: a 12-page PDF came back as ONE package, and re-uploading
    // it must produce the full set instead of "already imported".
    const buffer = track(pdfBytes());
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    await query(
      `INSERT INTO predefined_quote_imports (file_name, file_hash, file_size, status, extraction_version)
       VALUES ('legacy.pdf', $1, $2, 'needs_review', 1)`,
      [hash, buffer.length],
    );

    const result = await importPredefinedQuoteBrochure({
      buffer, fileName: 'legacy.pdf', contentType: 'application/pdf', ai: fakeAi({ offers: three }),
    });

    assert.equal(result.duplicate, false);
    assert.equal(result.importRecords.length, 3);
  });

  it('lets a failed import be retried instead of reporting it as a duplicate', async () => {
    const buffer = track(pdfBytes());
    await assert.rejects(
      () => importPredefinedQuoteBrochure({
        buffer, fileName: 'flaky.pdf', contentType: 'application/pdf',
        ai: fakeAi({ offers: three, failFor: three.map((o) => o.name) }),
      }),
      /Could not extract this brochure/,
    );
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const failed = await query('SELECT status, error_message FROM predefined_quote_imports WHERE file_hash = $1', [hash]);
    assert.equal(failed.rows[0].status, 'failed');
    assert.ok(failed.rows[0].error_message);

    const retry = await importPredefinedQuoteBrochure({
      buffer, fileName: 'flaky.pdf', contentType: 'application/pdf', ai: fakeAi({ offers: three }),
    });
    assert.equal(retry.duplicate, false);
    assert.equal(retry.importRecords.length, 3);
  });

  it('does not leave a half-saved batch behind when extraction fails', async () => {
    const buffer = track(pdfBytes());
    await assert.rejects(() => importPredefinedQuoteBrochure({
      buffer, fileName: 'none.pdf', contentType: 'application/pdf',
      ai: fakeAi({ offers: three, failFor: three.map((o) => o.name) }),
    }));
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const rows = await query(`SELECT status FROM predefined_quote_imports WHERE file_hash = $1`, [hash]);
    assert.deepEqual(rows.rows.map((r) => r.status), ['failed']);
  });

  it('rejects a non-brochure upload before spending anything', async () => {
    const spy = fakeAi({ offers: three });
    await assert.rejects(
      () => importPredefinedQuoteBrochure({
        buffer: Buffer.from('this is not a pdf or image'), fileName: 'notes.txt', ai: spy,
      }),
      /Upload a PDF/,
    );
    assert.equal(spy.calls.outline, 0);
  });
});

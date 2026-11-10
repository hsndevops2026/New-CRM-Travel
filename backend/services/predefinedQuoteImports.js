import crypto from 'node:crypto';
import OpenAI from 'openai';
import { openaiConfig } from '../config/openai.js';
import { pool, query } from '../config/database.js';
import {
  createPredefinedQuote,
  normalizeQuoteInput,
  updatePredefinedQuote,
} from './predefinedQuotes.js';

// One brochure now fans out into several parallel calls, so be patient with 429s.
const client = openaiConfig.apiKey
  ? new OpenAI({ apiKey: openaiConfig.apiKey, maxRetries: 4 })
  : null;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** 1 = legacy single package, 2 = one package per offer, 3 = round-trip fare normalization. */
export const EXTRACTION_VERSION = 3;

const MIME_BY_KIND = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

const EXT_BY_KIND = {
  pdf: '.pdf',
  png: '.png',
  jpeg: '.jpg',
  webp: '.webp',
  gif: '.gif',
};

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const nullableString = { type: ['string', 'null'] };
const nullableNumber = { type: ['number', 'null'] };
const nullableInteger = { type: ['integer', 'null'] };

const itemProperties = {
  item_type: { type: 'string', enum: ['hotel', 'flight'] },
  title: nullableString,
  description: nullableString,
  image_url: nullableString,
  price: nullableNumber,
  currency: nullableString,
  hotel_name: nullableString,
  city: nullableString,
  country: nullableString,
  category: nullableString,
  board_name: nullableString,
  room_name: nullableString,
  check_in: nullableString,
  check_out: nullableString,
  nights: nullableInteger,
  airline: nullableString,
  flight_number: nullableString,
  departure_airport: nullableString,
  arrival_airport: nullableString,
  departure_city: nullableString,
  arrival_city: nullableString,
  departure_time: nullableString,
  arrival_time: nullableString,
  duration: nullableString,
  stops: nullableInteger,
  direction: { type: ['string', 'null'], enum: ['outbound', 'return', null] },
};

export const PACKAGE_IMPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['package', 'warnings'],
  properties: {
    package: {
      type: 'object',
      additionalProperties: false,
      required: [
        'title', 'origin', 'destination', 'description', 'cover_image_url', 'currency',
        'total_price', 'notes', 'travel_date', 'return_date', 'nights',
        'adults_count', 'children_count', 'items',
      ],
      properties: {
        title: { type: 'string' },
        origin: nullableString,
        destination: nullableString,
        description: nullableString,
        cover_image_url: nullableString,
        currency: { type: 'string' },
        total_price: nullableNumber,
        notes: nullableString,
        travel_date: nullableString,
        return_date: nullableString,
        nights: nullableInteger,
        adults_count: { type: 'integer' },
        children_count: { type: 'integer' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: Object.keys(itemProperties),
            properties: itemProperties,
          },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
};

const EXTRACTION_PROMPT = `Extract this travel brochure, hotel rate sheet, FIT/SPO promotion, or flight offer into a predefined package for employee review.

The file may be a PDF or a photo/scan (PNG/JPEG/WebP/GIF). Text may be Arabic, English, or mixed. Read all visible OCR text carefully. Prefer English field values. If the document itself prints an Arabic name, keep it in parentheses; never translate names or add Arabic text that is not printed in the document.

Use only information visible in the document. Do not invent dates, prices, airports, hotels, inclusions, or images.
Use YYYY-MM-DD when a complete date is present; otherwise return null and add a warning.
Use null for unknown fields. If there is no usable hotel or flight, return an empty items list and explain why in warnings.

Hotel rate tables / seasonal grids:
- Create one hotel item for EACH date-period row printed for the hotel (every season / period listed) for the primary room and meal plan shown. Never collapse several periods into one item: four printed periods means four items.
- Pricing column: rate tables have one column per occupancy (SGL / سنجل = single, DBL / دبل = double, TPL = triple, ...). Read the column headers first. Each item's price is that period's value in the DBL column - not the SGL column when a DBL column exists; use SGL only when there is no DBL column. Put the SGL, Triple/Quadruple and other occupancy prices in notes.
- Set board_name from the meal plan (e.g. Soft All Inclusive, BB, HB, Soft All, Hard All).
- Set room_name / category from the room type (e.g. Standard Room).
- Put check_in = period start and check_out = period end when the row is a season range; add a warning that these are rate-period dates, not a confirmed stay.
- Put the full rate grid (all periods, SGL/DBL/TPL, meal plans) into notes as readable text.
- Put room upgrades/supplements (per room per night) and child policies into notes.
- Set destination from the location on the sheet (city/resort). Set hotel_name and title from the hotel header.
- Set city and country on each hotel item when the location is printed (city/resort and country).
- Set currency from symbols ($, USD, AED, etc.). total_price may be null for rate sheets; put a representative double rate on the first hotel item.

Flight promotional flyers:
- Create one flight item per priced offer (outbound and return as separate items when both legs are shown).
- A price printed beside a complete round-trip route is the fare for that itinerary, not a price for each leg. Put that fare on the outbound item only, leave the paired return item's price null, and set total_price to the sum of the separately printed round-trip fares. For example, two round-trip options priced 490 and 550 have total_price 1040, not 2080.
- Extract airline, route cities/airports, times, frequency, and the offer price.
- Put season/validity and booking conditions into notes or description.

General packages:
- One item per hotel option and one item per flight leg.
- Put inclusions, exclusions, cancellation terms, validity, and other conditions in description or notes.`;

/* ------------------------------------------------------------------ *
 * Pass 1 — outline: a structured list of every offer in the document.
 *
 * Asking one call for "the package" forced a whole rate sheet into a single
 * package; asking one call for ALL packages risks the JSON being cut off at the
 * model's output limit. So the document is first reduced to a small outline, and
 * each offer is then extracted on its own (pass 2).
 * ------------------------------------------------------------------ */

export const OUTLINE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['offers', 'warnings'],
  properties: {
    offers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'kind', 'destination', 'pages'],
        properties: {
          name: { type: 'string' },
          kind: { type: 'string', enum: ['hotel', 'flight', 'package'] },
          destination: nullableString,
          pages: { type: 'string' },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
};

const OUTLINE_PROMPT = `List every separately sellable offer in this travel document so each one can be extracted on its own. Do NOT extract prices or details yet - only identify the offers.

- A rate sheet or brochure that lists several hotels: ONE entry per hotel, named exactly as printed.
- A flight flyer: ONE entry per priced route / offer.
- A single tour or itinerary that bundles flights and hotels under one price: ONE entry for the whole package.
- Several different packages (e.g. "Dubai 5 nights", "Istanbul 7 nights"): one entry per package.
- Skip cover pages, terms-only pages, maps, contact pages and general information - they are not offers.
- If the same hotel appears on several pages, return it ONCE and list all of its pages.
- "pages" is where this offer's data is printed, e.g. "3", "3-4" or "3, 9". For a single image use "1".
- Return offers in document order. Never invent an offer that is not in the document.
- If the document has no usable offer, return an empty list and explain why in warnings.`;

/** Collapses a name to letters/digits so "Rixos  Premium" and "rixos-premium" match. */
function offerKey(name) {
  return String(name || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Cleans the model's outline: drops nameless entries, merges the same offer listed
 * twice (combining its pages), and caps the total so a bad read cannot fan out into
 * hundreds of paid calls.
 */
export function normalizeOutline(outline, { maxOffers = 40 } = {}) {
  const warnings = Array.isArray(outline?.warnings) ? outline.warnings.map(String) : [];
  const merged = new Map();

  for (const raw of Array.isArray(outline?.offers) ? outline.offers : []) {
    const name = String(raw?.name || '').trim();
    const key = offerKey(name);
    if (!key) continue;

    const pages = String(raw?.pages || '').trim();
    const existing = merged.get(key);
    if (existing) {
      if (pages && !existing.pages.split(/\s*,\s*/).includes(pages)) {
        existing.pages = existing.pages ? `${existing.pages}, ${pages}` : pages;
      }
      continue;
    }
    merged.set(key, {
      name,
      kind: ['hotel', 'flight', 'package'].includes(raw?.kind) ? raw.kind : 'package',
      destination: raw?.destination ? String(raw.destination).trim() : null,
      pages: pages.slice(0, 60),
    });
  }

  let offers = [...merged.values()];
  if (offers.length > maxOffers) {
    warnings.push(
      `The document lists ${offers.length} offers; only the first ${maxOffers} were extracted. Split the file to import the rest.`,
    );
    offers = offers.slice(0, maxOffers);
  }
  return { offers, warnings };
}

/** Prompt for pass 2: the full extraction rules, narrowed to one offer. */
export function buildOfferPrompt(offer) {
  if (!offer) return EXTRACTION_PROMPT;
  return `${EXTRACTION_PROMPT}

FOCUS - this document contains several offers that are extracted separately. Extract ONLY the offer below and ignore every other hotel, flight and package in the document:
- Name: ${offer.name}
- Type: ${offer.kind}${offer.destination ? `\n- Destination: ${offer.destination}` : ''}${offer.pages ? `\n- Printed on page(s): ${offer.pages}` : ''}
Title the package after this offer. Include every date-period row, price and condition printed for it.`;
}

/**
 * Runs `fn` over `items` with at most `limit` in flight, keeping input order.
 * Never rejects: each slot is { ok: true, value } or { ok: false, error }.
 */
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { ok: true, value: await fn(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

async function callStructured({ ai, model, content, prompt, name, schema }) {
  const response = await ai.responses.create({
    model,
    store: false,
    input: [{ role: 'user', content: [content, { type: 'input_text', text: prompt }] }],
    text: { format: { type: 'json_schema', name, strict: true, schema } },
  });
  // A cut-off response is invalid JSON; say so rather than surfacing a parse error.
  if (response.status === 'incomplete') {
    throw new Error(
      `AI output was cut off (${response.incomplete_details?.reason || 'incomplete'})`,
    );
  }
  return JSON.parse(response.output_text || '{}');
}

/**
 * Extracts every package in a brochure.
 *
 * @returns {Promise<{ packages: Array<{ payload: object, warnings: string[], offer: object|null }>, outline: object, warnings: string[] }>}
 */
export async function extractBrochurePackages({
  buffer,
  kind,
  fileName,
  ai = client,
  model = openaiConfig.importModel,
  concurrency = Number(process.env.BROCHURE_EXTRACT_CONCURRENCY) || 6,
  maxOffers = Number(process.env.BROCHURE_MAX_PACKAGES) || 40,
} = {}) {
  const content = buildModelContent(buffer, kind, fileName);

  // Pass 1 — what is in this document?
  const outline = normalizeOutline(
    await callStructured({
      ai, model, content, prompt: OUTLINE_PROMPT, name: 'brochure_outline', schema: OUTLINE_SCHEMA,
    }),
    { maxOffers },
  );
  const documentWarnings = [...outline.warnings];

  // Pass 2 — extract each offer on its own. If the outline found nothing (an odd
  // layout, a photo), fall back to the legacy whole-document read instead of
  // returning zero packages.
  const targets = outline.offers.length ? outline.offers : [null];
  if (!outline.offers.length) {
    documentWarnings.push(
      'Could not split the document into separate offers; extracted it as a single package.',
    );
  }

  const results = await mapWithConcurrency(targets, concurrency, async (offer) => {
    let lastError;
    // One retry: a malformed/odd response is usually fine the second time.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const parsed = await callStructured({
          ai, model, content,
          prompt: buildOfferPrompt(offer),
          name: 'predefined_package_import',
          schema: PACKAGE_IMPORT_SCHEMA,
        });
        return {
          payload: cleanPackagePayload(parsed.package),
          warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [],
          offer,
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  });

  const packages = [];
  results.forEach((result, index) => {
    if (result.ok) {
      packages.push(result.value);
    } else {
      const label = targets[index]?.name || 'the document';
      const pages = targets[index]?.pages ? ` (pages ${targets[index].pages})` : '';
      documentWarnings.push(
        `Could not extract ${label}${pages}: ${result.error?.message || 'AI extraction failed'}. Re-upload to retry.`,
      );
    }
  });

  if (!packages.length) {
    throw new Error(documentWarnings.join(' ') || 'No packages could be extracted');
  }
  return { packages, outline, warnings: documentWarnings };
}

function normalizedPlace(value) {
  return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function reversedRoute(outbound, returning, prefix) {
  const outboundFrom = normalizedPlace(outbound?.[`departure_${prefix}`]);
  const outboundTo = normalizedPlace(outbound?.[`arrival_${prefix}`]);
  const returnFrom = normalizedPlace(returning?.[`departure_${prefix}`]);
  const returnTo = normalizedPlace(returning?.[`arrival_${prefix}`]);
  return Boolean(
    outboundFrom && outboundTo && returnFrom && returnTo
    && outboundFrom === returnTo && outboundTo === returnFrom
  );
}

function extractedPrice(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Models a flyer fare once per round-trip itinerary. Vision models commonly copy a
 * fare printed beside a return route onto both generated leg items; summing those
 * items then doubles the advertised amount.
 */
export function normalizeRoundTripFlightPrices(raw) {
  const payload = raw && typeof raw === 'object' ? raw : {};
  const items = Array.isArray(payload.items) ? payload.items.map((item) => ({ ...item })) : [];
  if (payload.total_price != null && payload.total_price !== '') return { ...payload, items };
  if (items.length < 2 || items.some((item) => item.item_type !== 'flight')) return { ...payload, items };

  const matchedOutbound = new Set();
  let pairs = 0;
  for (let returnIndex = 0; returnIndex < items.length; returnIndex += 1) {
    const returning = items[returnIndex];
    const returnPrice = extractedPrice(returning.price);
    if (returning.direction !== 'return' || returnPrice == null) continue;

    for (let outboundIndex = returnIndex - 1; outboundIndex >= 0; outboundIndex -= 1) {
      const outbound = items[outboundIndex];
      if (matchedOutbound.has(outboundIndex) || outbound.direction !== 'outbound') continue;
      if (extractedPrice(outbound.price) !== returnPrice) continue;
      if (!reversedRoute(outbound, returning, 'city') && !reversedRoute(outbound, returning, 'airport')) continue;

      matchedOutbound.add(outboundIndex);
      returning.price = null;
      pairs += 1;
      break;
    }
  }

  if (!pairs) return { ...payload, items };
  const totalPrice = items.reduce((sum, item) => sum + (extractedPrice(item.price) || 0), 0);
  return { ...payload, total_price: totalPrice || null, items };
}

function cleanPackagePayload(raw) {
  const payload = raw && typeof raw === 'object' ? raw : {};
  const items = Array.isArray(payload.items) ? payload.items : [];
  return normalizeRoundTripFlightPrices({
    ...payload,
    origin: payload.origin || '',
    destination: payload.destination || '',
    description: payload.description || '',
    cover_image_url: payload.cover_image_url || '',
    notes: payload.notes || '',
    travel_date: payload.travel_date || '',
    return_date: payload.return_date || '',
    currency: payload.currency || 'USD',
    adults_count: payload.adults_count ?? 2,
    children_count: payload.children_count ?? 0,
    items: items.map((item) => Object.fromEntries(
      Object.entries(item).map(([key, value]) => [key, value ?? '']),
    )),
  });
}

function mapImport(row) {
  return {
    ...row,
    file_size: Number(row.file_size) || 0,
    warnings: Array.isArray(row.warnings) ? row.warnings : [],
  };
}

function extensionOf(fileName = '') {
  const match = String(fileName).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

/** Detect brochure kind from magic bytes, optional MIME hint, and file name. */
export function detectBrochureKind(buffer, { contentType = '', fileName = '' } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5) {
    throw httpError(400, 'Upload a PDF or image brochure');
  }

  const head = buffer.subarray(0, 12);
  if (head.subarray(0, 5).toString('ascii') === '%PDF-') return 'pdf';
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (
    head.subarray(0, 4).toString('ascii') === 'RIFF'
    && head.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  if (head.subarray(0, 6).toString('ascii') === 'GIF87a' || head.subarray(0, 6).toString('ascii') === 'GIF89a') {
    return 'gif';
  }

  const mime = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpeg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';

  const ext = extensionOf(fileName);
  if (ext === 'pdf') return 'pdf';
  if (ext === 'png') return 'png';
  if (ext === 'jpg' || ext === 'jpeg') return 'jpeg';
  if (ext === 'webp') return 'webp';
  if (ext === 'gif') return 'gif';

  throw httpError(400, 'Upload a PDF, PNG, JPEG, WebP, or GIF brochure');
}

export function brochureMime(kind) {
  return MIME_BY_KIND[kind] || 'application/octet-stream';
}

function defaultFileName(kind, fileName) {
  const raw = String(fileName || '').trim();
  if (raw) return raw.slice(0, 255);
  return `brochure${EXT_BY_KIND[kind] || ''}`;
}

function buildModelContent(buffer, kind, fileName) {
  const mime = brochureMime(kind);
  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
  if (kind === 'pdf') {
    return {
      type: 'input_file',
      filename: defaultFileName(kind, fileName),
      file_data: dataUrl,
      detail: 'high',
    };
  }
  return {
    type: 'input_image',
    image_url: dataUrl,
    detail: 'high',
  };
}

export async function listPredefinedQuoteImports({ status, limit = 50 } = {}) {
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const result = status
    ? await query(
        `SELECT i.*, uploader.email AS uploaded_by_email, reviewer.email AS reviewed_by_email
         FROM predefined_quote_imports i
         LEFT JOIN admins uploader ON uploader.id = i.uploaded_by
         LEFT JOIN admins reviewer ON reviewer.id = i.reviewed_by
         WHERE i.status = $1
         ORDER BY i.created_at DESC, i.batch_index ASC NULLS FIRST LIMIT $2`,
        [status, cap],
      )
    : await query(
        `SELECT i.*, uploader.email AS uploaded_by_email, reviewer.email AS reviewed_by_email
         FROM predefined_quote_imports i
         LEFT JOIN admins uploader ON uploader.id = i.uploaded_by
         LEFT JOIN admins reviewer ON reviewer.id = i.reviewed_by
         ORDER BY i.created_at DESC, i.batch_index ASC NULLS FIRST LIMIT $1`,
        [cap],
      );
  return result.rows.map(mapImport);
}

export async function getPredefinedQuoteImport(id) {
  const result = await query(`SELECT * FROM predefined_quote_imports WHERE id = $1`, [id]);
  return result.rows[0] ? mapImport(result.rows[0]) : null;
}

/**
 * Reserves this file for extraction, or returns the records already made from it.
 *
 * The hash lookup and the placeholder insert run under one advisory lock, otherwise
 * a double-clicked upload would pass the lookup twice and extract (and bill) twice.
 * Failed and rejected imports are not duplicates — the file must be retryable — and
 * neither are records made by an older extraction version, so a brochure can be
 * uploaded again when normalization rules improve.
 */
async function reserveImport({ hash, safeName, size, targetQuoteId, uploadedBy, reextract = false }) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [hash]);

    const existing = await db.query(
      `SELECT * FROM predefined_quote_imports
       WHERE file_hash = $1 AND extraction_version = $2
         AND status NOT IN ('failed', 'rejected')
       ORDER BY batch_index ASC NULLS FIRST, created_at ASC`,
      [hash, EXTRACTION_VERSION],
    );
    let replaces = [];
    if (existing.rows.length && !reextract) {
      await db.query('COMMIT');
      return { duplicate: existing.rows.map(mapImport) };
    }
    if (existing.rows.length) {
      // Reading it again while it is still being read would extract (and bill) twice.
      if (existing.rows.some((row) => row.status === 'processing')) {
        throw httpError(409, 'This brochure is still being read. Wait for it to finish, then try again.');
      }
      // Only packages nobody has approved yet are replaced; approved ones stay in the library.
      replaces = existing.rows.filter((row) => row.status === 'needs_review').map((row) => row.id);
    }

    const inserted = await db.query(
      `INSERT INTO predefined_quote_imports
         (file_name, file_hash, file_size, status, target_quote_id, uploaded_by,
          extraction_version, batch_id, batch_index)
       VALUES ($1, $2, $3, 'processing', $4, $5, $6, gen_random_uuid(), 0)
       RETURNING *`,
      [safeName, hash, size, targetQuoteId || null, uploadedBy || null, EXTRACTION_VERSION],
    );
    await db.query('COMMIT');
    return { placeholder: inserted.rows[0], replaces };
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}

/** Writes every extracted package at once: the placeholder becomes #1, the rest are inserted. */
async function saveExtractedBatch({ placeholder, extraction, kind, safeName, size, hash, uploadedBy }) {
  const { packages, warnings: documentWarnings } = extraction;
  const total = packages.length;

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const saved = [];

    for (let index = 0; index < total; index += 1) {
      const { payload, warnings: own, offer } = packages[index];
      const warnings = [...own, ...documentWarnings];
      if (!payload.title) warnings.push('Package title was not found.');
      if (!payload.items.length) warnings.push('No hotel or flight items were found.');
      if (kind !== 'pdf') warnings.push('Source was an image; verify OCR fields carefully before approval.');
      if (total > 1) warnings.push(`Package ${index + 1} of ${total} from ${safeName}.`);
      const warningsJson = JSON.stringify([...new Set(warnings)]);
      const pages = offer?.pages || null;

      // One shared created_at so the batch lists together and in order.
      const row = index === 0
        ? await db.query(
            `UPDATE predefined_quote_imports
             SET status = 'needs_review', extracted_payload = $2, warnings = $3,
                 batch_total = $4, source_pages = $5, created_at = NOW(), updated_at = NOW()
             WHERE id = $1 RETURNING *`,
            [placeholder.id, JSON.stringify(payload), warningsJson, total, pages],
          )
        : await db.query(
            `INSERT INTO predefined_quote_imports
               (file_name, file_hash, file_size, status, target_quote_id, uploaded_by,
                extracted_payload, warnings, extraction_version, batch_id, batch_index,
                batch_total, source_pages)
             VALUES ($1, $2, $3, 'needs_review', $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING *`,
            [
              safeName, hash, size, placeholder.target_quote_id, uploadedBy || null,
              JSON.stringify(payload), warningsJson, EXTRACTION_VERSION,
              placeholder.batch_id, index, total, pages,
            ],
          );
      saved.push(mapImport(row.rows[0]));
    }

    await db.query('COMMIT');
    return saved;
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}

export async function importPredefinedQuoteBrochure({
  buffer,
  fileName,
  contentType,
  uploadedBy,
  targetQuoteId,
  reextract = false,
  ai = client,
} = {}) {
  if (!ai) throw httpError(503, 'OpenAI is not configured');
  if (!Buffer.isBuffer(buffer) || buffer.length < 5) {
    throw httpError(400, 'Upload a PDF or image brochure');
  }
  if (buffer.length > MAX_FILE_BYTES) throw httpError(413, 'File must be smaller than 50 MB');

  const kind = detectBrochureKind(buffer, { contentType, fileName });
  const safeName = defaultFileName(kind, fileName);
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');

  const reserved = await reserveImport({
    hash, safeName, size: buffer.length, targetQuoteId, uploadedBy, reextract,
  });
  if (reserved.duplicate) {
    return {
      importRecord: reserved.duplicate[0],
      importRecords: reserved.duplicate,
      duplicate: true,
    };
  }
  const { placeholder, replaces = [] } = reserved;

  try {
    const extraction = await extractBrochurePackages({ buffer, kind, fileName: safeName, ai });
    const records = await saveExtractedBatch({
      placeholder, extraction, kind, safeName, size: buffer.length, hash, uploadedBy,
    });
    // Retire the old, unreviewed packages only now that the new read has succeeded — a
    // failed re-read must not leave the reviewer with nothing.
    if (replaces.length) {
      await query(
        `UPDATE predefined_quote_imports
         SET status = 'rejected', error_message = 'Replaced by a new extraction', updated_at = NOW()
         WHERE id = ANY($1::uuid[]) AND status = 'needs_review'`,
        [replaces],
      );
    }
    return { importRecord: records[0], importRecords: records, duplicate: false, replaced: replaces.length };
  } catch (error) {
    await query(
      `UPDATE predefined_quote_imports
       SET status = 'failed', error_message = $2, updated_at = NOW()
       WHERE id = $1`,
      [placeholder.id, String(error.message || 'AI extraction failed').slice(0, 2000)],
    );
    throw httpError(502, `Could not extract this brochure: ${error.message || 'AI extraction failed'}`);
  }
}

/** @deprecated Prefer importPredefinedQuoteBrochure — kept for older callers. */
export async function importPredefinedQuotePdf(args) {
  return importPredefinedQuoteBrochure(args);
}

export async function approvePredefinedQuoteImport(id, { payload, targetQuoteId, reviewerId } = {}) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const locked = await db.query(
      `SELECT * FROM predefined_quote_imports WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const importRecord = locked.rows[0];
    if (!importRecord) {
      await db.query('ROLLBACK');
      return null;
    }
    if (importRecord.status !== 'needs_review') {
      throw httpError(
        409,
        `This package was already ${importRecord.status}. Only imports waiting for review can be approved — close this window and pick the next one.`,
      );
    }
    const reviewedPayload = normalizeQuoteInput(payload || importRecord.extracted_payload);
    const target = targetQuoteId || importRecord.target_quote_id || null;
    const quote = target
      ? await updatePredefinedQuote(target, reviewedPayload, { client: db })
      : await createPredefinedQuote(reviewedPayload, { adminId: reviewerId, client: db });
    if (!quote) throw httpError(404, 'Target predefined package not found');

    const result = await db.query(
      `UPDATE predefined_quote_imports
       SET status = 'approved', extracted_payload = $2, target_quote_id = $3,
           approved_quote_id = $4, reviewed_by = $5, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, JSON.stringify(reviewedPayload), target, quote.id, reviewerId || null],
    );
    await db.query('COMMIT');
    return { importRecord: mapImport(result.rows[0]), quote };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

export async function rejectPredefinedQuoteImport(id, reviewerId) {
  const result = await query(
    `UPDATE predefined_quote_imports
     SET status = 'rejected', reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND status = 'needs_review' RETURNING *`,
    [id, reviewerId || null],
  );
  return result.rows[0] ? mapImport(result.rows[0]) : null;
}

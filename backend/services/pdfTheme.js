/**
 * The look of every quotation PDF: one place for fonts, colours and the building blocks
 * (header, facts strip, cards, price panel, notes, contact, page footers). The library
 * package PDF and the customer's versioned quote PDF both draw with this, so they read as
 * the same document from the same agency.
 *
 * Layout is explicit: `Page.y` is the cursor, `ensure(height)` starts a new page when the
 * next block would not fit, so a card is never split across two pages.
 */

import { createRequire } from 'module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchBrandLogo, resolvedBranding } from './pdfBranding.js';
import { arabicFont, drawText, measureTextHeight } from './pdfText.js';

const require = createRequire(import.meta.url);
const PDFDocument = require('pdfkit');

const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts');

export const FONT = { regular: 'Regular', semi: 'SemiBold', bold: 'Bold' };

export const INK = '#0F172A';
export const BODY = '#334155';
export const MUTED = '#64748B';
export const LINE = '#E2E8F0';
export const SURFACE = '#F8FAFC';

export const PAGE = { width: 595.28, height: 841.89, margin: 40, footer: 46, running: 34 };
export const CONTENT_W = PAGE.width - PAGE.margin * 2;

/* ── small utilities ───────────────────────────────────────────────────── */

function parseHex(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!match) return [15, 118, 110];
  return [0, 2, 4].map((i) => parseInt(match[1].slice(i, i + 2), 16));
}

/** `hex` blended towards white; amount 0 = the colour, 1 = white. */
export function tint(hex, amount) {
  const mixed = parseHex(hex).map((c) => Math.round(c + (255 - c) * amount));
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** Black or white, whichever reads on `hex` (WCAG relative luminance). */
export function readableOn(hex) {
  const [r, g, b] = parseHex(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.55 ? INK : '#FFFFFF';
}

export function money(amount, currency = 'USD') {
  if (amount == null || amount === '' || Number.isNaN(Number(amount))) return null;
  const value = Number(amount);
  try {
    return `${currency} ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)}`;
  } catch {
    return `${currency} ${Math.round(value)}`;
  }
}

export function formatDate(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function dateRange(from, to) {
  const a = formatDate(from);
  const b = formatDate(to);
  if (a && b) return a === b ? a : `${a} → ${b}`;
  return a || b || null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A range short enough for a narrow cell: "12–18 Dec 2026", "28 Nov – 3 Dec 2026". */
export function dateRangeCompact(from, to) {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(from ?? ''));
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(to ?? ''));
  if (!a || !b) return dateRange(from, to);
  const [ay, am, ad] = [Number(a[1]), Number(a[2]) - 1, Number(a[3])];
  const [by, bm, bd] = [Number(b[1]), Number(b[2]) - 1, Number(b[3])];
  if (ay === by && am === bm) return ad === bd ? `${ad} ${MONTHS[am]} ${ay}` : `${ad}–${bd} ${MONTHS[am]} ${ay}`;
  if (ay === by) return `${ad} ${MONTHS[am]} – ${bd} ${MONTHS[bm]} ${ay}`;
  return dateRange(from, to);
}

export function travellers(adults, children) {
  const a = Number(adults) || 0;
  const c = Number(children) || 0;
  const parts = [];
  if (a || !c) parts.push(`${a} adult${a === 1 ? '' : 's'}`);
  if (c) parts.push(`${c} child${c === 1 ? '' : 'ren'}`);
  return parts.join(', ');
}

export async function fetchImage(url) {
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length > 24 && buffer.length < 8_000_000 ? buffer : null;
  } catch {
    return null;
  }
}

/* ── document ──────────────────────────────────────────────────────────── */

export function createDocument({ title, author, subject } = {}) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 0, left: PAGE.margin, right: PAGE.margin, bottom: 0 },
    bufferPages: true,
    info: { Title: title || 'Travel quotation', Author: author || '', Subject: subject || 'Travel quotation' },
  });
  // Plex Sans for Latin (it has Turkish and the other European letters); Plex Sans Arabic for
  // Arabic runs. See pdfText.js, which picks between them per run (`<name>-AR`).
  for (const [name, file] of [[FONT.regular, 'Regular'], [FONT.semi, 'SemiBold'], [FONT.bold, 'Bold']]) {
    doc.registerFont(name, path.join(FONT_DIR, `IBMPlexSans-${file}.ttf`));
    doc.registerFont(arabicFont(name), path.join(FONT_DIR, `IBMPlexSansArabic-${file}.ttf`));
  }
  return doc;
}

/**
 * A document being written top to bottom. Create with `await Page.start(...)`, draw blocks,
 * then `page.finish()`.
 */
export class Page {
  constructor(doc, agency, runningTitle) {
    this.doc = doc;
    this.brand = resolvedBranding(agency);
    this.color = this.brand.primary_color;
    this.runningTitle = runningTitle || '';
    this.y = 0;
    this.limit = PAGE.height - PAGE.footer - 8;
    this.logo = null;
  }

  static async start(doc, agency, { runningTitle, label, issued, subtitle = 'Travel quotation' } = {}) {
    const page = new Page(doc, agency, runningTitle);
    page.logo = await fetchBrandLogo(page.brand.logo_url);
    page.drawBanner({ label, issued, subtitle });
    return page;
  }

  /** The brand band at the top of the first page. */
  drawBanner({ label, issued, subtitle }) {
    const { doc, brand, color } = this;
    // The agency's Modern template gets a taller, airier banner.
    const modern = brand.quotation_template === 'modern';
    const height = modern ? 112 : 92;
    const on = readableOn(color);
    doc.rect(0, 0, PAGE.width, height).fill(color);
    doc.save();
    doc.translate(0, modern ? 10 : 0);

    let textX = PAGE.margin;
    if (this.logo) {
      try {
        doc.save();
        doc.roundedRect(PAGE.margin, 22, 48, 48, 10).fill('#FFFFFF');
        doc.image(this.logo, PAGE.margin + 4, 26, { fit: [40, 40], align: 'center', valign: 'center' });
        doc.restore();
        textX = PAGE.margin + 62;
      } catch {
        textX = PAGE.margin;
      }
    } else {
      doc.roundedRect(PAGE.margin, 22, 48, 48, 10).fillOpacity(0.18).fill(on).fillOpacity(1);
      drawText(doc, (brand.agency_name || 'A').trim().charAt(0).toUpperCase(), PAGE.margin, 31, {
        width: 48, size: 22, font: FONT.bold, color: on, align: 'center',
      });
      textX = PAGE.margin + 62;
    }

    const nameWidth = PAGE.width - textX - PAGE.margin - 150;
    drawText(doc, brand.agency_name, textX, 29, { width: nameWidth, size: 17, font: FONT.bold, color: on });
    doc.save().fillOpacity(0.8);
    drawText(doc, subtitle, textX, 52, { width: nameWidth, size: 9.5, font: FONT.regular, color: on });
    doc.restore();

    if (label) {
      const chip = String(label).toUpperCase();
      doc.font(FONT.semi).fontSize(8);
      const w = doc.widthOfString(chip) + 18;
      const x = PAGE.width - PAGE.margin - w;
      doc.roundedRect(x, 27, w, 18, 9).fillOpacity(0.2).fill(on).fillOpacity(1);
      drawText(doc, chip, x, 32, { width: w, size: 8, font: FONT.semi, color: on, align: 'center' });
    }
    if (issued) {
      doc.save().fillOpacity(0.85);
      drawText(doc, `Issued ${issued}`, PAGE.margin, 54, {
        width: PAGE.width - PAGE.margin * 2, size: 9, font: FONT.regular, color: on, align: 'right',
      });
      doc.restore();
    }
    doc.restore();
    this.y = height + 26;
  }

  /** A slim header on pages after the first, so a loose page still says whose quote it is. */
  drawRunningHeader() {
    const { doc, color } = this;
    doc.rect(0, 0, PAGE.width, 4).fill(color);
    drawText(doc, [this.brand.agency_name, this.runningTitle].filter(Boolean).join('  ·  '), PAGE.margin, 16, {
      width: CONTENT_W, size: 8.5, font: FONT.semi, color: MUTED,
    });
    doc.moveTo(PAGE.margin, PAGE.running + 8).lineTo(PAGE.width - PAGE.margin, PAGE.running + 8).lineWidth(0.6).strokeColor(LINE).stroke();
    this.y = PAGE.running + 24;
  }

  /** Make room for a block `height` tall, starting a new page if it will not fit. */
  ensure(height) {
    if (this.y + height <= this.limit) return;
    this.doc.addPage();
    this.drawRunningHeader();
  }

  gap(points) {
    this.y += points;
  }

  /** Title block: the quote's name and one line under it. */
  hero(title, subtitle) {
    const { doc } = this;
    const titleHeight = measureTextHeight(doc, title, { width: CONTENT_W, size: 24, font: FONT.bold, lineGap: 1 });
    const subHeight = subtitle ? measureTextHeight(doc, subtitle, { width: CONTENT_W, size: 11, font: FONT.regular }) : 0;
    this.ensure(titleHeight + subHeight + 14);
    drawText(doc, title, PAGE.margin, this.y, { width: CONTENT_W, size: 24, font: FONT.bold, color: INK, lineGap: 1 });
    this.y += titleHeight + 4;
    if (subtitle) {
      drawText(doc, subtitle, PAGE.margin, this.y, { width: CONTENT_W, size: 11, font: FONT.regular, color: MUTED });
      this.y += subHeight + 2;
    }
    this.y += 14;
  }

  /** A row of up to four labelled facts in one tinted box. */
  facts(items) {
    const { doc } = this;
    const list = items.filter((item) => item && item.value);
    if (!list.length) return;
    const padding = 14;
    const cellW = (CONTENT_W - padding * 2) / list.length;
    const valueW = cellW - 10;
    const heights = list.map((item) => measureTextHeight(doc, item.value, { width: valueW, size: 11, font: FONT.semi, lineGap: 1 }));
    const height = 12 + 12 + Math.max(...heights) + 12 + 4;
    this.ensure(height + 14);
    const top = this.y;
    doc.roundedRect(PAGE.margin, top, CONTENT_W, height, 10).lineWidth(0.8).fillAndStroke(tint(this.color, 0.93), tint(this.color, 0.8));
    list.forEach((item, index) => {
      const x = PAGE.margin + padding + index * cellW;
      drawText(doc, item.label.toUpperCase(), x, top + 12, { width: valueW, size: 7.5, font: FONT.semi, color: MUTED });
      drawText(doc, item.value, x, top + 26, { width: valueW, size: 11, font: FONT.semi, color: INK, lineGap: 1 });
    });
    this.y = top + height + 16;
  }

  /** A paragraph of body text. */
  paragraph(text, { size = 10.5, color = BODY, gapAfter = 12 } = {}) {
    const { doc } = this;
    if (!text) return;
    const height = measureTextHeight(doc, text, { width: CONTENT_W, size, font: FONT.regular, lineGap: 3 });
    this.ensure(height + gapAfter);
    drawText(doc, text, PAGE.margin, this.y, { width: CONTENT_W, size, font: FONT.regular, color, lineGap: 3 });
    this.y += height + gapAfter;
  }

  /** A rounded picture across the page, if it can be drawn. */
  image(buffer, height = 168) {
    if (!buffer) return;
    this.ensure(height + 16);
    const { doc } = this;
    try {
      doc.save();
      doc.roundedRect(PAGE.margin, this.y, CONTENT_W, height, 12).clip();
      doc.image(buffer, PAGE.margin, this.y, { cover: [CONTENT_W, height], align: 'center', valign: 'center' });
      doc.restore();
      this.y += height + 16;
    } catch {
      this.doc.restore();
    }
  }

  /** Section title with a short brand-coloured rule. */
  section(title) {
    this.ensure(46);
    const { doc } = this;
    doc.roundedRect(PAGE.margin, this.y + 2, 4, 15, 2).fill(this.color);
    drawText(doc, title, PAGE.margin + 12, this.y, { width: CONTENT_W - 12, size: 13, font: FONT.bold, color: INK });
    this.y += 28;
  }

  /**
   * A bordered card. `measure(innerWidth)` returns the content height; `draw(x, y, innerWidth)`
   * paints it. The card is kept whole: if it will not fit, it starts the next page.
   */
  card({ measure, draw, padding = 14, fill = '#FFFFFF', gapAfter = 10 }) {
    const innerW = CONTENT_W - padding * 2;
    const content = measure(innerW);
    const height = content + padding * 2;
    this.ensure(height + gapAfter);
    const top = this.y;
    this.doc.roundedRect(PAGE.margin, top, CONTENT_W, height, 10).lineWidth(0.8).fillAndStroke(fill, LINE);
    draw(PAGE.margin + padding, top + padding, innerW);
    this.y = top + height + gapAfter;
  }

  /** A small rounded label. Returns its width. */
  chip(text, x, y, { fill, color, size = 7.5 } = {}) {
    const { doc } = this;
    const label = String(text).toUpperCase();
    doc.font(FONT.semi).fontSize(size);
    const w = doc.widthOfString(label) + 12;
    doc.roundedRect(x, y, w, size + 8, (size + 8) / 2).fill(fill || tint(this.color, 0.88));
    drawText(doc, label, x, y + 4, { width: w, size, font: FONT.semi, color: color || this.color, align: 'center' });
    return w;
  }

  /** The total, prominent, on a solid panel. */
  priceBlock({ label = 'Total price', amount, caption }) {
    if (!amount) return;
    const { doc } = this;
    const height = caption ? 96 : 76;
    this.ensure(height + 16);
    const top = this.y;
    const on = readableOn(this.color);
    doc.roundedRect(PAGE.margin, top, CONTENT_W, height, 14).fill(this.color);
    doc.save().fillOpacity(0.85);
    drawText(doc, label.toUpperCase(), PAGE.margin + 22, top + 18, { width: CONTENT_W - 44, size: 8.5, font: FONT.semi, color: on });
    doc.restore();
    drawText(doc, amount, PAGE.margin + 22, top + 32, { width: CONTENT_W - 44, size: 30, font: FONT.bold, color: on });
    if (caption) {
      doc.save().fillOpacity(0.85);
      drawText(doc, caption, PAGE.margin + 22, top + 72, { width: CONTENT_W - 44, size: 9.5, font: FONT.regular, color: on });
      doc.restore();
    }
    this.y = top + height + 18;
  }

  /** A tinted box with a heading — notes, terms. */
  note(title, text, { fill = '#FFFBEB', stroke = '#FDE68A' } = {}) {
    if (!text) return;
    const { doc } = this;
    const padding = 14;
    const innerW = CONTENT_W - padding * 2;
    const body = measureTextHeight(doc, text, { width: innerW, size: 9.5, font: FONT.regular, lineGap: 3 });
    const height = padding * 2 + 16 + body;
    this.ensure(height + 14);
    const top = this.y;
    doc.roundedRect(PAGE.margin, top, CONTENT_W, height, 10).lineWidth(0.8).fillAndStroke(fill, stroke);
    drawText(doc, title, PAGE.margin + padding, top + padding, { width: innerW, size: 10.5, font: FONT.bold, color: INK });
    drawText(doc, text, PAGE.margin + padding, top + padding + 18, { width: innerW, size: 9.5, font: FONT.regular, color: BODY, lineGap: 3 });
    this.y = top + height + 14;
  }

  /** How to reach the agency. */
  contact() {
    const { doc, brand } = this;
    const lines = [brand.phone, brand.email, brand.website, brand.address].filter(Boolean);
    if (!lines.length) return;
    const padding = 14;
    const innerW = CONTENT_W - padding * 2;
    const text = lines.join('   ·   ');
    const body = measureTextHeight(doc, text, { width: innerW, size: 9.5, font: FONT.regular, lineGap: 3 });
    const height = padding * 2 + 16 + body;
    this.ensure(height + 10);
    const top = this.y;
    doc.roundedRect(PAGE.margin, top, CONTENT_W, height, 10).lineWidth(0.8).fillAndStroke(SURFACE, LINE);
    drawText(doc, `Questions? Contact ${brand.agency_name}`, PAGE.margin + padding, top + padding, {
      width: innerW, size: 10.5, font: FONT.bold, color: INK,
    });
    drawText(doc, text, PAGE.margin + padding, top + padding + 18, { width: innerW, size: 9.5, font: FONT.regular, color: BODY, lineGap: 3 });
    this.y = top + height + 10;
  }

  /** Footers with page numbers on every page, then close the document. */
  finish() {
    const { doc, brand } = this;
    const range = doc.bufferedPageRange();
    const left = [`Prepared by ${brand.agency_name}`, brand.phone, brand.email].filter(Boolean).join('  ·  ');
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      const y = PAGE.height - 30;
      doc.moveTo(PAGE.margin, y - 10).lineTo(PAGE.width - PAGE.margin, y - 10).lineWidth(0.6).strokeColor(LINE).stroke();
      drawText(doc, left, PAGE.margin, y, { width: CONTENT_W - 80, size: 8, font: FONT.regular, color: MUTED });
      drawText(doc, `Page ${i - range.start + 1} of ${range.count}`, PAGE.width - PAGE.margin - 80, y, {
        width: 80, size: 8, font: FONT.regular, color: MUTED, align: 'right',
      });
    }
    doc.end();
  }
}

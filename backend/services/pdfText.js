/**
 * Text for PDFs that may mix English and Arabic.
 *
 * PDFKit lays text out left to right, so an Arabic hotel name comes out reversed or as
 * empty boxes. Shaping and right-to-left glyph order are handled by the font engine when
 * a run is drawn with the `rtla` feature; what it can't do is mix directions in one line.
 * This module does that part: it splits text into runs by script, wraps them, and places
 * the runs of each line in the right visual order. Latin runs use the Latin font (Plex Sans:
 * Turkish and other European letters) and Arabic runs its Arabic twin (`<name>-AR`).
 *
 * The pure helpers (`splitRuns`, `layoutLines`, `cleanText`) take plain inputs so they can
 * be tested without a PDF.
 */

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const LATIN_OR_DIGIT = /[A-Za-z0-9À-ɏ]/;

/** The Arabic-capable twin of a registered font name (see createDocument in pdfTheme.js). */
export function arabicFont(name) {
  return `${name}-AR`;
}

export function hasArabic(text) {
  return ARABIC.test(String(text ?? ''));
}

/**
 * Text as it is safe to draw: stars become words ("4★" → "4-star") because no text font has
 * the glyph, runs of spaces become one, and control characters go.
 */
export function cleanText(text) {
  return String(text ?? '')
    .replace(/(\d)\s*[★☆]+/g, '$1-star')
    .replace(/[★☆]+/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F​-‍﻿]/g, '')
    .replace(/[ \t]+/g, ' ');
}

/** Removes characters the current font has no glyph for, instead of drawing empty boxes. */
function drawable(doc, text) {
  const face = doc._font?.font;
  if (!face?.hasGlyphForCodePoint) return text;
  let out = '';
  for (const char of text) {
    if (char === '\n' || char === ' ' || face.hasGlyphForCodePoint(char.codePointAt(0))) out += char;
  }
  return out;
}

/** 'rtl' when the first strong character is Arabic, else 'ltr'. */
export function paragraphDirection(text) {
  for (const char of String(text ?? '')) {
    if (ARABIC.test(char)) return 'rtl';
    if (LATIN_OR_DIGIT.test(char)) return 'ltr';
  }
  return 'ltr';
}

/**
 * Words in logical order, grouped into runs of the same direction. A word with any Arabic
 * letter is Arabic; everything else (Latin, digits, "—", "·") is left-to-right.
 * @returns {{ rtl: boolean, words: string[] }[]}
 */
export function splitRuns(text) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const runs = [];
  for (const word of words) {
    const rtl = ARABIC.test(word);
    const last = runs[runs.length - 1];
    if (last && last.rtl === rtl) last.words.push(word);
    else runs.push({ rtl, words: [word] });
  }
  return runs;
}

/**
 * Breaks text into lines no wider than `width`, each line a list of runs already in
 * visual (left to right on the page) order.
 *
 * @param {string} text
 * @param {number} width
 * @param {(text: string, rtl: boolean) => number} measure width of a string drawn as given
 * @param {'ltr'|'rtl'} [direction] paragraph direction (default: from the first letter)
 * @returns {{ runs: { text: string, rtl: boolean, width: number }[], width: number }[]}
 */
export function layoutLines(text, width, measure, direction = paragraphDirection(text)) {
  const space = measure(' ', false);
  const lines = [];
  let current = [];
  let currentWidth = 0;

  const flush = () => {
    if (!current.length) return;
    lines.push(toVisualLine(current, measure, direction, space));
    current = [];
    currentWidth = 0;
  };

  for (const { rtl, words } of splitRuns(text)) {
    for (const word of words) {
      const w = measure(word, rtl);
      const gap = current.length ? space : 0;
      if (current.length && currentWidth + gap + w > width) flush();
      currentWidth += (current.length ? space : 0) + w;
      current.push({ word, rtl });
    }
  }
  flush();
  return lines;
}

function toVisualLine(entries, measure, direction, space) {
  // Re-group the line's words into runs, then order the runs for display.
  const runs = [];
  for (const entry of entries) {
    const last = runs[runs.length - 1];
    if (last && last.rtl === entry.rtl) last.words.push(entry.word);
    else runs.push({ rtl: entry.rtl, words: [entry.word] });
  }
  const placed = runs.map((run) => {
    const text = run.words.join(' ');
    return { text, rtl: run.rtl, width: measure(text, run.rtl) };
  });
  // In a right-to-left paragraph the first run sits at the right edge.
  const ordered = direction === 'rtl' ? [...placed].reverse() : placed;
  const width = ordered.reduce((sum, run) => sum + run.width, 0) + space * Math.max(0, ordered.length - 1);
  return { runs: ordered, width };
}

/** Width of `str` at the doc's current size, in the Arabic twin of `font` for Arabic runs. */
function runWidth(doc, font, str, rtl) {
  doc.font(rtl ? arabicFont(font) : font);
  return doc.widthOfString(drawable(doc, str), rtl ? { features: ['rtla'] } : undefined);
}

/**
 * Draws (possibly mixed-direction) text and returns the height it used.
 *
 * @param {PDFDocument} doc
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {{ width: number, size?: number, font?: string, color?: string, align?: 'left'|'right'|'center',
 *           lineGap?: number }} opts
 */
export function drawText(doc, text, x, y, opts) {
  const value = cleanText(text).trim();
  if (!value) return 0;
  const { width, size = 10, font = 'Regular', color = '#1E293B', lineGap = -2 } = opts;
  doc.font(font).fontSize(size).fillColor(color);

  if (!hasArabic(value)) {
    const clean = drawable(doc, value);
    const height = doc.heightOfString(clean, { width, lineGap });
    doc.text(clean, x, y, { width, lineGap, align: opts.align || 'left' });
    return height;
  }

  const direction = paragraphDirection(value);
  const align = opts.align || (direction === 'rtl' ? 'right' : 'left');
  const measure = (str, rtl) => runWidth(doc, font, str, rtl);
  const lines = layoutLines(value, width, measure, direction);
  const space = measure(' ', false);
  doc.font(font);
  const lineHeight = doc.currentLineHeight(true) + lineGap;

  lines.forEach((line, index) => {
    let cursor = align === 'right' ? x + width - line.width : align === 'center' ? x + (width - line.width) / 2 : x;
    const top = y + index * lineHeight;
    for (const run of line.runs) {
      doc.font(run.rtl ? arabicFont(font) : font).fontSize(size).fillColor(color);
      doc.text(drawable(doc, run.text), cursor, top, { lineBreak: false, features: run.rtl ? ['rtla'] : undefined });
      cursor += run.width + space;
    }
  });
  return lines.length * lineHeight;
}

/** Height `drawText` would use for the same text, without drawing. */
export function measureTextHeight(doc, text, opts) {
  const value = cleanText(text).trim();
  if (!value) return 0;
  const { width, size = 10, font = 'Regular', lineGap = -2 } = opts;
  doc.font(font).fontSize(size);
  if (!hasArabic(value)) return doc.heightOfString(drawable(doc, value), { width, lineGap });
  const measure = (str, rtl) => runWidth(doc, font, str, rtl);
  const count = layoutLines(value, width, measure).length;
  doc.font(font);
  return count * (doc.currentLineHeight(true) + lineGap);
}

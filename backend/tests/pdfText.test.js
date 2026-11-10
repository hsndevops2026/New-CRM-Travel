import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanText, hasArabic, layoutLines, paragraphDirection, splitRuns } from '../services/pdfText.js';

// Every character is 10 wide, so widths are easy to reason about.
const measure = (text) => text.length * 10;

describe('direction', () => {
  it('knows Arabic from Latin, by the first letter that decides it', () => {
    assert.equal(hasArabic('Mövenpick'), false);
    assert.equal(hasArabic('ميفنبيك'), true);
    assert.equal(paragraphDirection('ميفنبيك Resort'), 'rtl');
    assert.equal(paragraphDirection('Resort ميفنبيك'), 'ltr');
    assert.equal(paragraphDirection('12 ميفنبيك'), 'ltr', 'a leading number is not Arabic');
    assert.equal(paragraphDirection(''), 'ltr');
  });
});

describe('splitRuns', () => {
  it('groups neighbouring words of the same script into one run', () => {
    assert.deepEqual(splitRuns('Resort ميفنبيك ريزورت طابا 2026'), [
      { rtl: false, words: ['Resort'] },
      { rtl: true, words: ['ميفنبيك', 'ريزورت', 'طابا'] },
      { rtl: false, words: ['2026'] },
    ]);
  });
  it('is empty for blank text', () => {
    assert.deepEqual(splitRuns('   '), []);
  });
});

describe('layoutLines', () => {
  it('wraps at the width', () => {
    const lines = layoutLines('one two three four', 100, measure);
    assert.deepEqual(lines.map((l) => l.runs.map((r) => r.text).join(' ')), ['one two', 'three four']);
    assert.ok(lines.every((l) => l.width <= 100));
  });

  it('keeps a left-to-right paragraph in reading order', () => {
    const [line] = layoutLines('Hotel ميفنبيك طابا Taba', 1000, measure);
    assert.deepEqual(line.runs.map((r) => r.text), ['Hotel', 'ميفنبيك طابا', 'Taba']);
    assert.deepEqual(line.runs.map((r) => r.rtl), [false, true, false]);
  });

  it('puts the first run of a right-to-left paragraph at the right edge', () => {
    const [line] = layoutLines('ميفنبيك طابا Resort 2026', 1000, measure);
    // Reading order is Arabic, then the English; on the page that is mirrored.
    assert.deepEqual(line.runs.map((r) => r.text), ['Resort 2026', 'ميفنبيك طابا']);
  });

  it('keeps an English phrase inside an Arabic line in its own reading order', () => {
    const [line] = layoutLines('فندق Grand Hotel طابا', 1000, measure);
    assert.deepEqual(line.runs.map((r) => r.text), ['طابا', 'Grand Hotel', 'فندق']);
  });

  it('reports a line’s width including the gaps between runs', () => {
    const [line] = layoutLines('ab ميف cd', 1000, measure);
    assert.equal(line.width, 20 + 30 + 20 + 10 * 2);
  });

  it('never loses a word, even one wider than the line', () => {
    const lines = layoutLines('short extraordinarilylongword end', 60, measure);
    const words = lines.flatMap((l) => l.runs.flatMap((r) => r.text.split(' ')));
    assert.deepEqual(words.sort(), ['end', 'extraordinarilylongword', 'short']);
  });

  it('returns no lines for no text', () => {
    assert.deepEqual(layoutLines('', 100, measure), []);
  });
});

describe('cleanText', () => {
  it('spells out stars, which no text font can draw', () => {
    assert.equal(cleanText('Hilton 4★'), 'Hilton 4-star');
    assert.equal(cleanText('Hilton 5 ★★★★★'), 'Hilton 5-star');
    assert.equal(cleanText('★ Featured'), ' Featured');
  });
  it('collapses runs of spaces and drops control and zero-width characters', () => {
    assert.equal(cleanText('a   b\t c​\u0007d'), 'a b cd');
  });
  it('is safe on null and numbers', () => {
    assert.equal(cleanText(null), '');
    assert.equal(cleanText(42), '42');
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapImageResult } from '../services/googleImages.js';

describe('mapImageResult', () => {
  it('maps a google_images result entry', () => {
    const image = mapImageResult({
      position: 1,
      thumbnail: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:thumb',
      related_content_id: 'X0RPcnJfOEhrVHRpb01cSFJ',
      source: 'wikipedia.org',
      source_logo: 'https://example.com/logo.png',
      title: 'Maldives beach at sunset',
      link: 'https://en.wikipedia.org/wiki/Maldives',
      original: 'https://upload.wikimedia.org/maldives.jpg',
      original_width: 2400,
      original_height: 1600,
      is_product: false,
    });

    assert.equal(image.title, 'Maldives beach at sunset');
    assert.equal(image.original, 'https://upload.wikimedia.org/maldives.jpg');
    assert.equal(image.width, 2400);
    assert.equal(image.height, 1600);
    assert.equal(image.source, 'wikipedia.org');
    assert.equal(image.is_product, false);
    assert.equal(image.unsafe, false);
    assert.equal(image.url, 'https://upload.wikimedia.org/maldives.jpg');
  });

  it('falls back to the thumbnail when a result has no original URL', () => {
    // Some result pages return thumbnail-only entries.
    const image = mapImageResult({
      position: 1,
      thumbnail: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:thumb',
      source: 'Expedia',
      title: 'Maldives Beach Resort',
    });

    assert.equal(image.original, null);
    assert.equal(image.url, 'https://encrypted-tbn0.gstatic.com/images?q=tbn:thumb');
  });

  it('coerces missing fields to null rather than undefined', () => {
    const image = mapImageResult({});
    assert.equal(image.original, null);
    assert.equal(image.url, null);
    assert.equal(image.width, null);
    assert.equal(image.title, null);
    assert.equal(image.is_product, false);
  });
});

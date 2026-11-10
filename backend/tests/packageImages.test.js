import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  enrichPredefinedQuoteImages,
  hotelImageSearchQuery,
} from '../services/packageImages.js';

describe('hotelImageSearchQuery', () => {
  it('builds a hotel + place query for Google Images', () => {
    assert.equal(
      hotelImageSearchQuery(
        { hotel_name: 'Atlantis The Palm', city: 'Dubai', country: 'UAE' },
        'Dubai',
      ),
      'Atlantis The Palm Dubai UAE hotel',
    );
  });
});

describe('enrichPredefinedQuoteImages', () => {
  it('fills missing hotel image_url, gallery, and cover from search results', async () => {
    const searches = [];
    const uploads = [];
    const payload = {
      destination: 'Dubai',
      cover_image_url: null,
      items: [
        {
          item_type: 'hotel',
          hotel_name: 'Atlantis The Palm',
          city: 'Dubai',
          country: 'UAE',
          image_url: null,
          extra: {},
        },
        {
          item_type: 'flight',
          airline: 'EK',
          image_url: null,
          extra: {},
        },
      ],
    };

    await enrichPredefinedQuoteImages(payload, {
      maxPerHotel: 3,
      searchImages: async ({ query }) => {
        searches.push(query);
        return {
          images: [
            { original: 'https://cdn.example/a.jpg', url: 'https://cdn.example/a.jpg' },
            { original: 'https://cdn.example/b.jpg', url: 'https://cdn.example/b.jpg' },
            { original: 'https://cdn.example/c.jpg', url: 'https://cdn.example/c.jpg' },
          ],
        };
      },
      uploadImage: async (url) => {
        uploads.push(url);
        return url.replace('cdn.example', 'res.cloudinary.com/demo');
      },
    });

    const hotel = payload.items[0];
    assert.match(searches[0], /Atlantis The Palm/);
    assert.equal(hotel.image_url, 'https://res.cloudinary.com/demo/a.jpg');
    assert.equal(hotel.extra.gallery_urls.length, 3);
    assert.equal(payload.cover_image_url, hotel.image_url);
    assert.equal(payload.items[1].image_url, null);
    assert.equal(uploads.length, 3);
  });

  it('does not overwrite an existing hotel image or gallery', async () => {
    let searched = 0;
    const payload = {
      destination: 'Rome',
      cover_image_url: 'https://keep.cover/cover.jpg',
      items: [
        {
          item_type: 'hotel',
          hotel_name: 'Hassler',
          city: 'Rome',
          image_url: 'https://keep.me/hotel.jpg',
          extra: { gallery_urls: ['https://keep.me/hotel.jpg', 'https://keep.me/2.jpg'] },
        },
      ],
    };

    await enrichPredefinedQuoteImages(payload, {
      searchImages: async () => {
        searched += 1;
        return { images: [{ original: 'https://cdn.example/new.jpg' }] };
      },
      uploadImage: async (url) => url,
    });

    assert.equal(searched, 0);
    assert.equal(payload.items[0].image_url, 'https://keep.me/hotel.jpg');
    assert.equal(payload.cover_image_url, 'https://keep.cover/cover.jpg');
  });
});

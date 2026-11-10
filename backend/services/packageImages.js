/**
 * Auto-fill predefined package hotel photos from Google Images (SerpApi),
 * then host them on Cloudinary when configured.
 *
 * Runs on package create/update. Existing manually set image_url / cover are kept.
 * Extra gallery URLs are stored on each hotel item as extra.gallery_urls.
 */

import { searchGoogleImages } from './googleImages.js';
import { uploadRemoteImageToCloudinary } from './uploads.js';

const DEFAULT_MAX_PER_HOTEL = Math.max(
  1,
  Math.min(20, Number(process.env.PACKAGE_IMAGES_PER_HOTEL || 8)),
);

export function hotelImageSearchQuery(hotel, destination) {
  const parts = [
    hotel?.hotel_name || hotel?.title,
    hotel?.city,
    hotel?.country,
    destination && destination !== hotel?.city ? destination : null,
    'hotel',
  ];
  return parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ');
}

async function hostImage(remoteUrl, uploadImage) {
  const source = String(remoteUrl || '').trim();
  if (!source) return null;
  try {
    // uploadRemoteImageToCloudinary returns null when Cloudinary is unset —
    // fall back to the SerpApi original URL so the package still gets a photo.
    return (await uploadImage(source)) || source;
  } catch (error) {
    console.error('[packageImages] Cloudinary upload failed:', error.message);
    return source;
  }
}

async function fetchHotelGallery(hotel, destination, {
  maxPerHotel,
  searchImages,
  uploadImage,
}) {
  const query = hotelImageSearchQuery(hotel, destination);
  if (!query) return { image_url: null, gallery_urls: [] };

  const { images } = await searchImages({
    query,
    limit: maxPerHotel,
    imgsz: 'l',
    licenses: process.env.SERPAPI_IMAGES_LICENSES || 'f',
    safe: 'active',
  });

  const sources = (images || [])
    .map((image) => image.original || image.url)
    .filter(Boolean)
    .slice(0, maxPerHotel);

  const hosted = [];
  for (const source of sources) {
    const url = await hostImage(source, uploadImage);
    if (url) hosted.push(url);
  }

  return {
    image_url: hosted[0] || null,
    gallery_urls: hosted,
  };
}

function existingGallery(extra) {
  const list = extra?.gallery_urls;
  return Array.isArray(list) ? list.map(String).filter(Boolean) : [];
}

/**
 * Mutates a normalized predefined-quote payload in place with hotel photos.
 * Soft-fails per hotel so a SerpApi blip does not block saving the package.
 */
export async function enrichPredefinedQuoteImages(
  payload,
  {
    searchImages = searchGoogleImages,
    uploadImage = uploadRemoteImageToCloudinary,
    maxPerHotel = DEFAULT_MAX_PER_HOTEL,
  } = {},
) {
  if (!payload || !Array.isArray(payload.items)) return payload;

  const destination = payload.destination || null;
  const hotels = payload.items.filter((item) => item.item_type === 'hotel');

  for (const hotel of hotels) {
    const hasPrimary = Boolean(String(hotel.image_url || '').trim());
    const gallery = existingGallery(hotel.extra);
    if (hasPrimary && gallery.length) continue;

    try {
      const fetched = await fetchHotelGallery(hotel, destination, {
        maxPerHotel,
        searchImages,
        uploadImage,
      });
      if (!fetched.gallery_urls.length) continue;

      if (!hasPrimary) hotel.image_url = fetched.image_url;
      hotel.extra = {
        ...(hotel.extra && typeof hotel.extra === 'object' ? hotel.extra : {}),
        gallery_urls: gallery.length ? gallery : fetched.gallery_urls,
        gallery_query: hotelImageSearchQuery(hotel, destination),
      };
    } catch (error) {
      console.error(
        `[packageImages] fetch failed for "${hotel.hotel_name || hotel.title}":`,
        error.message,
      );
    }
  }

  if (!String(payload.cover_image_url || '').trim()) {
    const firstHotelImage =
      hotels.find((hotel) => hotel.image_url)?.image_url ||
      hotels.find((hotel) => existingGallery(hotel.extra).length)?.extra?.gallery_urls?.[0] ||
      null;
    if (firstHotelImage) {
      payload.cover_image_url = firstHotelImage;
    } else if (destination) {
      try {
        const { images } = await searchImages({
          query: `${destination} travel destination`,
          limit: 5,
          imgsz: 'l',
          licenses: process.env.SERPAPI_IMAGES_LICENSES || 'f',
          safe: 'active',
        });
        const source = images?.[0]?.original || images?.[0]?.url;
        if (source) payload.cover_image_url = await hostImage(source, uploadImage);
      } catch (error) {
        console.error('[packageImages] cover fetch failed:', error.message);
      }
    }
  }

  return payload;
}

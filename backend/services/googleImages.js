/**
 * Google Images via SerpApi (engine: google_images).
 *
 * Used to find destination / hotel photography when a supplier feed returns no
 * image — e.g. filling the hero image on a predefined package, or illustrating
 * a destination in a quote PDF.
 *
 * Licensing: raw image search returns third-party copyrighted images. The
 * search endpoint is unfiltered (admin browsing), but pickImageForSubject() —
 * the helper meant for auto-filling customer-facing artwork — defaults to
 * usage-rights-filtered results (SERPAPI_IMAGES_LICENSES, default 'f' = free to
 * use or share). Always confirm rights before publishing an image to a client.
 */

import { serpGet } from './serpClient.js';

const DEFAULT_LICENSES = process.env.SERPAPI_IMAGES_LICENSES || 'f';

/** Normalizes one `images_results[]` entry. */
export function mapImageResult(entry) {
  return {
    position: entry?.position ?? null,
    title: entry?.title || null,
    thumbnail: entry?.thumbnail || null,
    original: entry?.original || null,
    // Best displayable URL — some result pages carry thumbnails only.
    url: entry?.original || entry?.thumbnail || null,
    width: entry?.original_width ?? null,
    height: entry?.original_height ?? null,
    source: entry?.source || null,
    source_logo: entry?.source_logo || null,
    link: entry?.link || null,
    tag: entry?.tag || null,
    is_product: Boolean(entry?.is_product),
    in_stock: entry?.in_stock ?? null,
    unsafe: Boolean(entry?.unsafe),
    related_content_id: entry?.related_content_id || null,
  };
}

export async function searchGoogleImages({
  query,
  limit = 20,
  safe = 'active',
  imgsz,
  imgar,
  image_color,
  licenses,
  tbs,
  page = 0,
  hl,
  gl,
} = {}) {
  const raw = String(query || '').trim();
  if (!raw) {
    const error = new Error('query is required');
    error.status = 400;
    throw error;
  }

  // Sending ijn=0 explicitly returns a degraded first page whose entries carry
  // only thumbnails; omitting it returns the full result set with `original`
  // URLs. Only send ijn when actually paginating.
  const pageIndex = Math.max(0, Number(page) || 0);

  const data = await serpGet(
    'google_images',
    {
      q: raw,
      safe,
      imgsz,
      imgar,
      image_color,
      licenses,
      tbs,
      ijn: pageIndex > 0 ? pageIndex : undefined,
    },
    { hl, gl },
  );

  const results = Array.isArray(data?.images_results) ? data.images_results : [];
  const images = results
    .map(mapImageResult)
    .filter((image) => !image.unsafe && image.url)
    .slice(0, Math.max(1, Number(limit) || 20));

  return {
    query: raw,
    count: images.length,
    page: pageIndex,
    images,
  };
}

/**
 * Best single image for a subject (destination, hotel, package).
 * Filtered to usage-rights-safe, landscape-ish, non-product photography.
 */
export async function pickImageForSubject(subject, options = {}) {
  const { images } = await searchGoogleImages({
    query: subject,
    limit: 20,
    imgsz: options.imgsz || 'l',
    licenses: options.licenses ?? DEFAULT_LICENSES,
    safe: 'active',
    hl: options.hl,
    gl: options.gl,
  });

  // Artwork needs a full-resolution source, not a gstatic thumbnail.
  const usable = images.filter(
    (image) => !image.is_product && image.original && image.width && image.height,
  );
  if (!usable.length) return images[0] || null;

  // Prefer wide images — hero slots and PDF banners are landscape.
  const scored = usable.map((image) => {
    const ratio = image.width / image.height;
    const landscape = ratio >= 1.2 && ratio <= 2.4 ? 1 : 0;
    return { image, score: landscape * 100 + Math.min(image.width, 4000) / 1000 };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].image;
}

import { Router } from 'express';
import { searchGoogleImages, pickImageForSubject } from '../services/googleImages.js';

const router = Router();

/** Image search (SerpApi google_images) — admin browsing, unfiltered by default. */
router.get('/images/search', async (req, res) => {
  try {
    const query = req.query.query || req.query.q;
    if (!query) return res.status(400).json({ error: 'query parameter is required' });

    const result = await searchGoogleImages({
      query,
      limit: Number(req.query.limit) || 20,
      safe: req.query.safe || 'active',
      imgsz: req.query.imgsz,
      imgar: req.query.imgar,
      image_color: req.query.image_color,
      licenses: req.query.licenses,
      tbs: req.query.tbs,
      page: req.query.page,
      hl: req.query.hl,
      gl: req.query.gl,
    });
    res.json(result);
  } catch (error) {
    console.error('Image search failed:', error.message);
    res.status(error.status || 500).json({ error: error.message });
  }
});

/**
 * Best single image for a subject — usage-rights filtered, landscape-preferred.
 * Intended for auto-filling package / destination artwork.
 */
router.get('/images/pick', async (req, res) => {
  try {
    const query = req.query.query || req.query.q;
    if (!query) return res.status(400).json({ error: 'query parameter is required' });

    const image = await pickImageForSubject(query, {
      imgsz: req.query.imgsz,
      licenses: req.query.licenses,
      hl: req.query.hl,
      gl: req.query.gl,
    });

    if (!image) return res.status(404).json({ error: `No image found for "${query}"` });
    res.json({ query, image });
  } catch (error) {
    console.error('Image pick failed:', error.message);
    res.status(error.status || 500).json({ error: error.message });
  }
});

export default router;

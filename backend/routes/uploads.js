import { Router } from 'express';
import { createCloudinarySignature } from '../services/uploads.js';

const router = Router();

router.get('/uploads/cloudinary-sign', (_req, res) => {
  try {
    res.json(createCloudinarySignature());
  } catch (error) {
    console.error('Cloudinary signature failed:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Failed to sign upload' });
  }
});

export default router;

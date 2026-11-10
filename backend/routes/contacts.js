import { Router } from 'express';
import {
  deleteContact,
  listContacts,
  updateContact,
  upsertContact,
} from '../services/contacts.js';
import { getContactProfile } from '../services/contactProfile.js';

const router = Router();

router.get('/contacts', async (req, res) => {
  try {
    const contacts = await listContacts({
      query: req.query.query || req.query.q || '',
      limit: Number(req.query.limit) || 200,
    });
    res.json({ count: contacts.length, contacts });
  } catch (error) {
    console.error('List contacts failed:', error);
    res.status(500).json({ error: 'Failed to list contacts' });
  }
});

router.get('/contacts/:id/profile', async (req, res) => {
  try {
    const profile = await getContactProfile(req.params.id, {
      userId: req.admin?.role === 'agent' ? req.admin.id : null,
    });
    if (!profile) return res.status(404).json({ error: 'Contact not found' });
    res.json(profile);
  } catch (error) {
    console.error('Contact profile failed:', error);
    res.status(500).json({ error: 'Failed to load contact profile' });
  }
});

router.post('/contacts', async (req, res) => {
  try {
    const contact = await upsertContact({
      phone: req.body?.phone,
      name: req.body?.name,
      email: req.body?.email,
    });
    res.status(201).json({ contact });
  } catch (error) {
    console.error('Create contact failed:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Failed to save contact' });
  }
});

router.patch('/contacts/:id', async (req, res) => {
  try {
    const contact = await updateContact(req.params.id, {
      name: req.body?.name,
      phone: req.body?.phone,
      email: req.body?.email,
    });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    res.json({ contact });
  } catch (error) {
    console.error('Update contact failed:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Failed to update contact' });
  }
});

router.delete('/contacts/:id', async (req, res) => {
  try {
    const contact = await deleteContact(req.params.id);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    res.json({ deleted: true, contact });
  } catch (error) {
    console.error('Delete contact failed:', error);
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

export default router;

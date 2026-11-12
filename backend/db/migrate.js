import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../config/database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Base schema from init.sql — safe on empty DBs (CI) and existing Docker volumes.
 */
export async function runInitSchema() {
  const sql = await readFile(join(__dirname, 'init.sql'), 'utf8');
  await pool.query(sql);
}

/**
 * Apply additive schema changes for existing databases.
 */
export async function runMigrations() {
  await runInitSchema();
  await pool.query(`
    ALTER TABLE leads
      ADD COLUMN IF NOT EXISTS booking_type VARCHAR(16) NOT NULL DEFAULT 'hotel',
      ADD COLUMN IF NOT EXISTS origin TEXT,
      ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'new',
      ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'whatsapp';
  `);

  await pool.query(`
    ALTER TABLE leads
      ADD COLUMN IF NOT EXISTS quote_status VARCHAR(16),
      ADD COLUMN IF NOT EXISTS quote_error TEXT,
      ADD COLUMN IF NOT EXISTS quotes_fetched_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS quote_search JSONB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS flight_quotes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      external_id TEXT,
      price NUMERIC,
      currency VARCHAR(8) NOT NULL DEFAULT 'USD',
      outbound JSONB,
      inbound JSONB,
      raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_leads_booking_type ON leads (booking_type);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_flight_quotes_lead_id ON flight_quotes (lead_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_leads_quote_status ON leads (quote_status);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS hotel_quotes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      external_id TEXT,
      hotel_name TEXT,
      category TEXT,
      destination_code TEXT,
      destination_name TEXT,
      zone_name TEXT,
      latitude NUMERIC,
      longitude NUMERIC,
      price NUMERIC,
      currency VARCHAR(8) NOT NULL DEFAULT 'USD',
      rate_key TEXT,
      rate_type TEXT,
      board_code TEXT,
      board_name TEXT,
      cancellation_policies JSONB,
      raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_hotel_quotes_lead_id ON hotel_quotes (lead_id);
  `);

  await pool.query(`
    ALTER TABLE hotel_quotes
      ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'hotelbeds';
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      admin_id UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      jti UUID NOT NULL UNIQUE,
      family_id UUID NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      replaced_by UUID REFERENCES refresh_tokens(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_admin_id ON refresh_tokens (admin_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family_id ON refresh_tokens (family_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens (expires_at);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contacts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      phone VARCHAR(32) NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts (name);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dealers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      phone VARCHAR(32) NOT NULL UNIQUE,
      company TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dealers_name ON dealers (name);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dealer_country_codes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      iso_code VARCHAR(2),
      dial_code VARCHAR(3) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT dealer_country_codes_dial_digits CHECK (dial_code ~ '^[0-9]{1,3}$'),
      CONSTRAINT dealer_country_codes_iso_format CHECK (iso_code IS NULL OR iso_code ~ '^[A-Z]{2}$')
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      key TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agency_settings (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      agency_name TEXT NOT NULL,
      agency_slug TEXT NOT NULL,
      logo_url TEXT,
      primary_color VARCHAR(7) NOT NULL DEFAULT '#0f766e',
      quotation_template VARCHAR(16) NOT NULL DEFAULT 'classic',
      phone TEXT,
      email TEXT,
      website TEXT,
      address TEXT,
      quotation_footer TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT agency_settings_color CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
      CONSTRAINT agency_settings_template CHECK (quotation_template IN ('classic', 'modern'))
    );
  `);
  await pool.query(
    `INSERT INTO agency_settings
       (id, agency_name, agency_slug, logo_url, primary_color, quotation_template,
        phone, email, website, address, quotation_footer)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO NOTHING`,
    [
      process.env.AGENCY_NAME || 'Horizon',
      process.env.AGENCY_SLUG || 'horizon',
      process.env.AGENCY_LOGO_URL || null,
      process.env.AGENCY_PRIMARY_COLOR || '#0f766e',
      process.env.AGENCY_QUOTATION_TEMPLATE || 'classic',
      process.env.AGENCY_PHONE || null,
      process.env.AGENCY_EMAIL || null,
      process.env.AGENCY_WEBSITE || null,
      process.env.AGENCY_ADDRESS || null,
      process.env.AGENCY_QUOTATION_FOOTER || 'Prices are indicative and subject to availability.',
    ],
  );
  await pool.query(`
    WITH first_seed AS (
      INSERT INTO app_migrations (key)
      VALUES ('seed_dealer_country_codes_v1')
      ON CONFLICT (key) DO NOTHING
      RETURNING key
    )
    INSERT INTO dealer_country_codes (name, iso_code, dial_code)
    SELECT defaults.name, defaults.iso_code, defaults.dial_code
    FROM (VALUES
      ('United Arab Emirates', 'AE', '971'), ('Saudi Arabia', 'SA', '966'),
      ('India', 'IN', '91'), ('Pakistan', 'PK', '92'), ('Egypt', 'EG', '20'),
      ('Qatar', 'QA', '974'), ('Kuwait', 'KW', '965'), ('Bahrain', 'BH', '973'),
      ('Oman', 'OM', '968'), ('Jordan', 'JO', '962'), ('Israel', 'IL', '972'),
      ('Lebanon', 'LB', '961'), ('Turkey', 'TR', '90'),
      ('United Kingdom', 'GB', '44'), ('United States', 'US', '1'),
      ('France', 'FR', '33'), ('Germany', 'DE', '49'), ('Italy', 'IT', '39'),
      ('Spain', 'ES', '34'), ('Philippines', 'PH', '63')
    ) AS defaults(name, iso_code, dial_code)
    CROSS JOIN first_seed
    ON CONFLICT (dial_code) DO NOTHING;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS predefined_quotes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      quote_type VARCHAR(16) NOT NULL DEFAULT 'hotel',
      destination TEXT,
      origin TEXT,
      description TEXT,
      cover_image_url TEXT,
      currency VARCHAR(8) NOT NULL DEFAULT 'USD',
      total_price NUMERIC,
      notes TEXT,
      client_name TEXT,
      travel_date DATE,
      return_date DATE,
      nights INTEGER,
      adults_count INTEGER NOT NULL DEFAULT 2,
      children_count INTEGER NOT NULL DEFAULT 0,
      created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_predefined_quotes_updated_at ON predefined_quotes (updated_at DESC);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_predefined_quotes_quote_type ON predefined_quotes (quote_type);
  `);
  await pool.query(`
    ALTER TABLE predefined_quotes
      ADD COLUMN IF NOT EXISTS children_ages INTEGER[] NOT NULL DEFAULT '{}';
  `);
  // 'fixed' = the package is for exact dates (10–20 Oct); 'period' = it is for whole months
  // (Jan, Feb, Oct) and any trip inside those months can be offered it.
  await pool.query(`
    ALTER TABLE predefined_quotes
      ADD COLUMN IF NOT EXISTS availability_mode VARCHAR(8) NOT NULL DEFAULT 'fixed',
      ADD COLUMN IF NOT EXISTS available_months INTEGER[] NOT NULL DEFAULT '{}';
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS predefined_quote_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      quote_id UUID NOT NULL REFERENCES predefined_quotes(id) ON DELETE CASCADE,
      item_type VARCHAR(16) NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      title TEXT,
      description TEXT,
      image_url TEXT,
      price NUMERIC,
      currency VARCHAR(8) NOT NULL DEFAULT 'USD',
      hotel_name TEXT,
      city TEXT,
      country TEXT,
      category TEXT,
      board_name TEXT,
      room_name TEXT,
      check_in DATE,
      check_out DATE,
      nights INTEGER,
      airline TEXT,
      flight_number TEXT,
      departure_airport TEXT,
      arrival_airport TEXT,
      departure_city TEXT,
      arrival_city TEXT,
      departure_time TEXT,
      arrival_time TEXT,
      duration TEXT,
      stops INTEGER,
      direction VARCHAR(16),
      extra JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_predefined_quote_items_quote_id ON predefined_quote_items (quote_id);
  `);

  await pool.query(`
    ALTER TABLE predefined_quote_items
      ADD COLUMN IF NOT EXISTS city TEXT,
      ADD COLUMN IF NOT EXISTS country TEXT;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS predefined_quote_imports (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      file_name TEXT NOT NULL,
      file_hash VARCHAR(64) NOT NULL UNIQUE,
      file_size INTEGER NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'processing',
      target_quote_id UUID REFERENCES predefined_quotes(id) ON DELETE SET NULL,
      approved_quote_id UUID REFERENCES predefined_quotes(id) ON DELETE SET NULL,
      extracted_payload JSONB,
      warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
      error_message TEXT,
      uploaded_by UUID REFERENCES admins(id) ON DELETE SET NULL,
      reviewed_by UUID REFERENCES admins(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT predefined_quote_import_status CHECK (
        status IN ('processing', 'needs_review', 'approved', 'rejected', 'failed')
      )
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_predefined_quote_imports_status
      ON predefined_quote_imports (status, created_at DESC);
  `);

  // One brochure can now yield several packages (one per hotel / offer), each its own
  // import record so it can be reviewed, approved or rejected independently.
  // file_hash therefore can no longer be UNIQUE — it identifies the file, not the row.
  await pool.query(`
    ALTER TABLE predefined_quote_imports
      DROP CONSTRAINT IF EXISTS predefined_quote_imports_file_hash_key;
  `);
  await pool.query(`
    ALTER TABLE predefined_quote_imports
      ADD COLUMN IF NOT EXISTS batch_id UUID,
      ADD COLUMN IF NOT EXISTS batch_index INTEGER,
      ADD COLUMN IF NOT EXISTS batch_total INTEGER,
      ADD COLUMN IF NOT EXISTS source_pages TEXT,
      -- 1 = legacy single-package extractor, 2 = multi-package. Lets a brochure that
      -- was imported by the old extractor be re-extracted instead of reported as a duplicate.
      ADD COLUMN IF NOT EXISTS extraction_version INTEGER NOT NULL DEFAULT 1;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_predefined_quote_imports_file_hash
      ON predefined_quote_imports (file_hash);
  `);

  await pool.query(`
    ALTER TABLE leads
      ADD COLUMN IF NOT EXISTS predefined_quote_id UUID REFERENCES predefined_quotes(id) ON DELETE SET NULL;
  `);
  await pool.query(`
    ALTER TABLE leads
      ADD COLUMN IF NOT EXISTS pending_package_offer_id UUID REFERENCES predefined_quotes(id) ON DELETE SET NULL;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_leads_predefined_quote_id ON leads (predefined_quote_id);
  `);

  // ── Dealer flow: group IDs, RFQ requests & responses ───────────────────────

  // Extend dealers with WhatsApp group and service mappings
  await pool.query(`
    ALTER TABLE dealers
      ADD COLUMN IF NOT EXISTS whatsapp_group_id TEXT,
      ADD COLUMN IF NOT EXISTS destinations TEXT[] NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS services TEXT[] NOT NULL DEFAULT '{}';
  `);

  // Dealer RFQ requests (one per lead + dealer dispatch)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dealer_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      dealer_id UUID REFERENCES dealers(id) ON DELETE CASCADE,
      request_code TEXT NOT NULL UNIQUE,
      status VARCHAR(16) NOT NULL DEFAULT 'sent',
      message_body TEXT NOT NULL,
      sent_at TIMESTAMPTZ,
      deadline_at TIMESTAMPTZ,
      whatsapp_group_jid TEXT,
      group_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dealer_requests_lead_id ON dealer_requests (lead_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dealer_requests_dealer_id ON dealer_requests (dealer_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dealer_requests_code ON dealer_requests (request_code);
  `);

  // Dealer responses (raw reply + AI extraction + review state)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dealer_responses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      dealer_request_id UUID NOT NULL REFERENCES dealer_requests(id) ON DELETE CASCADE,
      raw_text TEXT NOT NULL,
      extracted JSONB,
      extraction_confidence TEXT,
      extraction_errors JSONB,
      review_status VARCHAR(16) NOT NULL DEFAULT 'pending',
      reviewed_by UUID REFERENCES admins(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMPTZ,
      provider_message_id TEXT,
      from_number TEXT,
      ai_rank_reason TEXT,
      is_recommended BOOLEAN NOT NULL DEFAULT FALSE,
      is_best BOOLEAN NOT NULL DEFAULT FALSE,
      best_confirmed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dealer_responses_request_id ON dealer_responses (dealer_request_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dealer_responses_review_status ON dealer_responses (review_status);
  `);

  // Unmatched group messages (exception inbox)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS unmatched_dealer_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      from_number TEXT,
      group_id TEXT,
      body TEXT,
      raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      resolved BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // ── Foundation: RBAC, lead assignment, lifecycle, messages, audit ──────────

  // Role column on admins (admin | agent)
  await pool.query(`
    ALTER TABLE admins
      ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'admin';
  `);
  await pool.query(`
    ALTER TABLE admins
      ADD COLUMN IF NOT EXISTS approval_status VARCHAR(16) NOT NULL DEFAULT 'approved',
      ADD COLUMN IF NOT EXISTS lead_credits INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS leads_used INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS user_leads (
      user_id UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, lead_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_leads_unique_lead ON user_leads (lead_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_admins_role ON admins (role);
  `);
  // New accounts default to the least privileged staff role; existing rows keep theirs.
  await pool.query(`
    ALTER TABLE admins ALTER COLUMN role SET DEFAULT 'agent';
  `);

  // Lead assignment and extended lifecycle status
  await pool.query(`
    ALTER TABLE leads
      ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES admins(id) ON DELETE SET NULL;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON leads (assigned_to);
  `);

  // lifecycle_status: intake | sourcing | awaiting_dealers | comparing | drafting
  //                   ready_to_send | sent | accepted | booked | lost | archived
  // Separate from the existing leads.status to avoid breaking existing code.
  await pool.query(`
    ALTER TABLE leads
      ADD COLUMN IF NOT EXISTS lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'intake';
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_leads_lifecycle_status ON leads (lifecycle_status);
  `);

  // Message history (customer and dealer communication)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
      direction VARCHAR(8) NOT NULL DEFAULT 'inbound',
      channel VARCHAR(16) NOT NULL DEFAULT 'whatsapp',
      provider_id TEXT,
      from_number TEXT,
      to_number TEXT,
      body TEXT,
      status VARCHAR(16) NOT NULL DEFAULT 'received',
      raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_messages_lead_id ON messages (lead_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_messages_provider_id ON messages (provider_id)
      WHERE provider_id IS NOT NULL;
  `);
  await pool.query(`
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS thread_kind VARCHAR(16);
  `);
  await pool.query(`
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS dealer_request_id UUID REFERENCES dealer_requests(id);
  `);
  await pool.query(`
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages (conversation_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_messages_lead_created ON messages (lead_id, created_at DESC);
  `);

  // Audit event log
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type TEXT NOT NULL,
      entity_id UUID,
      action TEXT NOT NULL,
      actor_id UUID REFERENCES admins(id) ON DELETE SET NULL,
      actor_role VARCHAR(16),
      before_state JSONB,
      after_state JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events (entity_type, entity_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events (actor_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events (created_at DESC);
  `);

  // ── Phase 3: Quote drafts, items ──────────────────────────────────────────

  // One draft per lead (upserted), holds pricing config and status
  await pool.query(`
    CREATE TABLE IF NOT EXISTS quote_drafts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id UUID NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,
      currency VARCHAR(8) NOT NULL DEFAULT 'USD',
      markup_type VARCHAR(8) NOT NULL DEFAULT 'percent',
      markup_value NUMERIC(10,4) NOT NULL DEFAULT 0,
      extras_amount NUMERIC(14,4) NOT NULL DEFAULT 0,
      extras_label TEXT,
      rounding_mode VARCHAR(8) NOT NULL DEFAULT 'none',
      status VARCHAR(16) NOT NULL DEFAULT 'draft',
      notes TEXT,
      valid_until DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_quote_drafts_lead_id ON quote_drafts (lead_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_quote_drafts_status ON quote_drafts (status);
  `);

  // Line items selected for a draft — each links to one normalized source
  await pool.query(`
    CREATE TABLE IF NOT EXISTS quote_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      quote_draft_id UUID NOT NULL REFERENCES quote_drafts(id) ON DELETE CASCADE,
      source_type VARCHAR(24) NOT NULL,
      source_id TEXT NOT NULL,
      label TEXT NOT NULL,
      description TEXT,
      net_cost NUMERIC(14,4),
      currency VARCHAR(8) NOT NULL DEFAULT 'USD',
      quantity INTEGER NOT NULL DEFAULT 1,
      item_order INTEGER NOT NULL DEFAULT 0,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_quote_items_draft_id ON quote_items (quote_draft_id);
  `);

  // ── Phase 4: Immutable quote versions, delivery, share tokens ─────────────

  // Locked snapshots created when a draft is sent
  await pool.query(`
    CREATE TABLE IF NOT EXISTS quote_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      quote_draft_id UUID NOT NULL REFERENCES quote_drafts(id) ON DELETE CASCADE,
      lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL DEFAULT 1,
      snapshot JSONB NOT NULL,
      selling_price NUMERIC(14,4),
      currency VARCHAR(8) NOT NULL DEFAULT 'USD',
      status VARCHAR(16) NOT NULL DEFAULT 'sent',
      accepted_at TIMESTAMPTZ,
      accepted_by TEXT,
      notes TEXT,
      created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_quote_versions_draft_id ON quote_versions (quote_draft_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_quote_versions_lead_id ON quote_versions (lead_id);
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_quote_versions_unique
      ON quote_versions (quote_draft_id, version_number);
  `);

  // Signed share tokens for public customer-facing view
  await pool.query(`
    CREATE TABLE IF NOT EXISTS share_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      quote_version_id UUID NOT NULL REFERENCES quote_versions(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked BOOLEAN NOT NULL DEFAULT FALSE,
      views INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_share_tokens_token ON share_tokens (token);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_share_tokens_version_id ON share_tokens (quote_version_id);
  `);

  // Delivery records — one per channel per send attempt
  await pool.query(`
    CREATE TABLE IF NOT EXISTS quote_deliveries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      quote_version_id UUID NOT NULL REFERENCES quote_versions(id) ON DELETE CASCADE,
      channel VARCHAR(16) NOT NULL,
      recipient TEXT NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      provider_id TEXT,
      error_message TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at TIMESTAMPTZ,
      sent_at TIMESTAMPTZ,
      delivered_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_quote_deliveries_version_id ON quote_deliveries (quote_version_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_quote_deliveries_status ON quote_deliveries (status);
  `);

  await pool.query(`
    ALTER TABLE dealer_requests
      ALTER COLUMN dealer_id DROP NOT NULL;
  `);
  await pool.query(`
    ALTER TABLE dealer_requests
      ADD COLUMN IF NOT EXISTS whatsapp_group_jid TEXT,
      ADD COLUMN IF NOT EXISTS group_name TEXT;
  `);
  await pool.query(`
    ALTER TABLE dealer_responses
      ADD COLUMN IF NOT EXISTS from_number TEXT,
      ADD COLUMN IF NOT EXISTS ai_rank_reason TEXT,
      ADD COLUMN IF NOT EXISTS is_recommended BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS is_best BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS best_confirmed_at TIMESTAMPTZ;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_groups (
      jid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      img_url TEXT,
      source TEXT,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE contacts
      ADD COLUMN IF NOT EXISTS email TEXT;
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_email_unique
      ON contacts (lower(email))
      WHERE email IS NOT NULL AND btrim(email) <> '';
  `);

  await pool.query(`
    ALTER TABLE admins
      ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_admins_contact_id_unique
      ON admins (contact_id)
      WHERE contact_id IS NOT NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contact_reminders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      remind_at TIMESTAMPTZ NOT NULL,
      done_at TIMESTAMPTZ,
      created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS contact_reminders_remind_at_idx ON contact_reminders (remind_at);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS contact_reminders_contact_id_idx ON contact_reminders (contact_id);
  `);
  // In-app notifications for staff, and the staff side of reminders.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      admin_id UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      kind VARCHAR(32) NOT NULL,
      lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
      contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      count INTEGER NOT NULL DEFAULT 1,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_admin ON notifications (admin_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications (admin_id, kind, lead_id) WHERE read_at IS NULL;
    ALTER TABLE contact_reminders ADD COLUMN IF NOT EXISTS staff_notified_at TIMESTAMPTZ;
  `);
  // Reminders already past their time when this ships should not all notify at once.
  const staffReminders = await pool.query(`
    INSERT INTO app_migrations (key) VALUES ('contact_reminders_staff_notify_v1')
    ON CONFLICT (key) DO NOTHING RETURNING key
  `);
  if (staffReminders.rowCount) {
    await pool.query(`UPDATE contact_reminders SET staff_notified_at = NOW() WHERE staff_notified_at IS NULL AND remind_at <= NOW()`);
  }

  // Gmail accounts connected by staff (ported from the Insurance CRM). Tokens are AES-256-GCM encrypted.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      admin_id UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      access_token_enc TEXT NOT NULL,
      refresh_token_enc TEXT NOT NULL,
      token_expiry TIMESTAMPTZ NOT NULL,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (admin_id, email)
    );
    CREATE TABLE IF NOT EXISTS email_oauth_states (
      state TEXT PRIMARY KEY,
      admin_id UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Customer language override set by staff (null = follow the WhatsApp conversation).
  await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(2)`);

  // Trip program per lead: activities, day trips and packages the employee picked.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trip_plan_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      day_number INTEGER CHECK (day_number IS NULL OR (day_number BETWEEN 1 AND 60)),
      position INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      kind VARCHAR(16) NOT NULL DEFAULT 'activity',
      source VARCHAR(16) NOT NULL DEFAULT 'general',
      package_id UUID REFERENCES predefined_quotes(id) ON DELETE SET NULL,
      price NUMERIC,
      currency VARCHAR(8),
      created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_trip_plan_items_lead ON trip_plan_items (lead_id, day_number, position);
  `);

  // Human takeover: while paused, the WhatsApp bot stores messages but never replies.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_handover (
      phone VARCHAR(32) PRIMARY KEY,
      paused BOOLEAN NOT NULL DEFAULT FALSE,
      paused_by UUID REFERENCES admins(id) ON DELETE SET NULL,
      paused_at TIMESTAMPTZ,
      resumed_at TIMESTAMPTZ,
      reason VARCHAR(32),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Customer reminders: opt-in per reminder, sent at remind_at by the worker sweep.
  await pool.query(`
    ALTER TABLE contact_reminders
      ADD COLUMN IF NOT EXISTS notify_customer BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
  `);
  // Reminders created before this change were already sent to the customer at
  // creation time. Mark them sent once so the new sweep never sends them again.
  const remindersScheduled = await pool.query(`
    INSERT INTO app_migrations (key)
    VALUES ('contact_reminders_scheduled_send_v1')
    ON CONFLICT (key) DO NOTHING
    RETURNING key
  `);
  if (remindersScheduled.rowCount) {
    await pool.query(`UPDATE contact_reminders SET sent_at = created_at WHERE sent_at IS NULL`);
  }
  await pool.query(`
    CREATE INDEX IF NOT EXISTS contact_reminders_due_idx
      ON contact_reminders (remind_at)
      WHERE notify_customer = TRUE AND sent_at IS NULL AND done_at IS NULL;
  `);

  // Rebuild booking_documents once — an earlier draft used url/public_id instead of file_url/title.
  const bookingDocsV2 = await pool.query(`
    INSERT INTO app_migrations (key)
    VALUES ('booking_documents_v2')
    ON CONFLICT (key) DO NOTHING
    RETURNING key
  `);
  if (bookingDocsV2.rowCount) {
    await pool.query(`DROP TABLE IF EXISTS booking_documents CASCADE`);
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS booking_documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      file_url TEXT NOT NULL,
      file_name TEXT,
      mime_type TEXT,
      uploaded_by UUID REFERENCES admins(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_booking_documents_lead_id
      ON booking_documents (lead_id, created_at DESC);
  `);
  // Set when a file is read on upload: what kind of document it is and the details used to name it.
  await pool.query(`ALTER TABLE booking_documents ADD COLUMN IF NOT EXISTS document_type VARCHAR(32)`);
  await pool.query(`ALTER TABLE booking_documents ADD COLUMN IF NOT EXISTS extracted JSONB`);

  // Tasks a manager gives to a staff member, optionally tied to a lead or contact.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff_tasks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      notes TEXT,
      assigned_to UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
      lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
      contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
      due_at TIMESTAMPTZ,
      status VARCHAR(16) NOT NULL DEFAULT 'open',
      done_at TIMESTAMPTZ,
      done_by UUID REFERENCES admins(id) ON DELETE SET NULL,
      due_notified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_staff_tasks_assignee ON staff_tasks (assigned_to, status, due_at);
    CREATE INDEX IF NOT EXISTS idx_staff_tasks_due ON staff_tasks (due_at) WHERE status = 'open' AND due_notified_at IS NULL;
  `);

  // Manager approval of quotes. off: never; agents: every quote an agent locks;
  // below_margin: an agent's quote whose margin is under quote_approval_min_margin (%).
  await pool.query(`
    ALTER TABLE agency_settings ADD COLUMN IF NOT EXISTS quote_approval_mode VARCHAR(16) NOT NULL DEFAULT 'agents';
    ALTER TABLE agency_settings ADD COLUMN IF NOT EXISTS quote_approval_min_margin NUMERIC(12,2) NOT NULL DEFAULT 10;
    ALTER TABLE agency_settings ALTER COLUMN quote_approval_min_margin TYPE NUMERIC(12,2);
    ALTER TABLE agency_settings ADD COLUMN IF NOT EXISTS quote_approval_min_margin_type VARCHAR(8) NOT NULL DEFAULT 'percent';
    ALTER TABLE quote_versions ADD COLUMN IF NOT EXISTS approval_status VARCHAR(16) NOT NULL DEFAULT 'not_required';
    ALTER TABLE quote_versions ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES admins(id) ON DELETE SET NULL;
    ALTER TABLE quote_versions ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
    ALTER TABLE quote_versions ADD COLUMN IF NOT EXISTS review_note TEXT;
    CREATE INDEX IF NOT EXISTS idx_quote_versions_pending_approval ON quote_versions (created_at) WHERE approval_status = 'pending';
  `);

  // Automatic customer messages and staff alerts (Settings → Automations). Customer
  // messages are off until the agency turns them on.
  await pool.query(`
    ALTER TABLE agency_settings ADD COLUMN IF NOT EXISTS auto_quote_followup BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE agency_settings ADD COLUMN IF NOT EXISTS quote_followup_hours INTEGER NOT NULL DEFAULT 48;
    ALTER TABLE agency_settings ADD COLUMN IF NOT EXISTS lead_wait_alert_minutes INTEGER NOT NULL DEFAULT 15;
    ALTER TABLE agency_settings ADD COLUMN IF NOT EXISTS auto_trip_messages BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE agency_settings ADD COLUMN IF NOT EXISTS google_review_url TEXT;
    ALTER TABLE agency_settings ADD COLUMN IF NOT EXISTS emergency_phone TEXT;

    CREATE TABLE IF NOT EXISTS automation_events (
      id BIGSERIAL PRIMARY KEY,
      kind VARCHAR(32) NOT NULL,
      lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
      ref TEXT NOT NULL DEFAULT '',
      data JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (kind, lead_id, ref)
    );

    CREATE TABLE IF NOT EXISTS trip_ratings (
      lead_id UUID PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
      phone VARCHAR(32) NOT NULL,
      rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      rated_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_trip_ratings_open ON trip_ratings (phone, requested_at) WHERE rating IS NULL;
  `);

  // WhatsApp polls the bot sent, with what each option stands for. A vote arrives as the
  // option's text, so it is mapped back to a package item / decision through this row.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_polls (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      phone TEXT NOT NULL,
      conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
      lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
      kind VARCHAR(32) NOT NULL,
      question TEXT NOT NULL,
      options JSONB NOT NULL,
      context JSONB NOT NULL DEFAULT '{}'::jsonb,
      provider_message_id TEXT,
      status VARCHAR(16) NOT NULL DEFAULT 'open',
      answer_value TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      answered_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_whatsapp_polls_open
      ON whatsapp_polls (phone, created_at DESC) WHERE status = 'open';
  `);

  // Growth: packages shown on the public offers page, and offers sent to past customers.
  await pool.query(`
    ALTER TABLE predefined_quotes ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE TABLE IF NOT EXISTS customer_outreach (
      id BIGSERIAL PRIMARY KEY,
      phone VARCHAR(32) NOT NULL,
      kind VARCHAR(32) NOT NULL DEFAULT 'seasonal_offer',
      offer_id UUID REFERENCES predefined_quotes(id) ON DELETE SET NULL,
      body TEXT,
      sent_by UUID REFERENCES admins(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_customer_outreach_phone ON customer_outreach (phone, created_at DESC);
  `);

  // Travellers on a booking, as written in their passports. The customer can fill them in
  // through a private link (lead_traveller_links) instead of sending passport photos.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lead_travellers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      full_name TEXT NOT NULL,
      is_child BOOLEAN NOT NULL DEFAULT FALSE,
      date_of_birth DATE,
      nationality TEXT,
      passport_number TEXT,
      passport_expiry DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_lead_travellers_lead ON lead_travellers (lead_id, position);

    CREATE TABLE IF NOT EXISTS lead_traveller_links (
      token TEXT PRIMARY KEY,
      lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      submitted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_lead_traveller_links_lead ON lead_traveller_links (lead_id);
  `);

  // Dates that cost money if missed: free cancellation, flight options, paying a supplier.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS booking_deadlines (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      kind VARCHAR(24) NOT NULL DEFAULT 'other',
      label TEXT NOT NULL,
      supplier TEXT,
      due_at TIMESTAMPTZ NOT NULL,
      status VARCHAR(12) NOT NULL DEFAULT 'open',
      source VARCHAR(16) NOT NULL DEFAULT 'manual',
      source_ref TEXT,
      warned_at TIMESTAMPTZ,
      overdue_notified_at TIMESTAMPTZ,
      created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
      done_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_booking_deadlines_open ON booking_deadlines (due_at) WHERE status = 'open';
    CREATE INDEX IF NOT EXISTS idx_booking_deadlines_lead ON booking_deadlines (lead_id, due_at);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_deadlines_source ON booking_deadlines (lead_id, source, source_ref) WHERE source_ref IS NOT NULL;
  `);

  const { seedDemoPredefinedQuotes } = await import('./seedPredefinedQuotes.js');
  await seedDemoPredefinedQuotes();

  console.log('Database migrations applied');
}

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  language VARCHAR(8) DEFAULT 'en',
  collected JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_phone_status
  ON conversations (phone, status);

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  phone VARCHAR(32) NOT NULL,
  booking_type VARCHAR(16) NOT NULL DEFAULT 'hotel',
  origin TEXT,
  destination TEXT NOT NULL,
  travel_date DATE NOT NULL,
  return_date DATE NOT NULL,
  nights INTEGER NOT NULL,
  adults_count INTEGER NOT NULL DEFAULT 1,
  children_count INTEGER NOT NULL DEFAULT 0,
  children_ages INTEGER[] NOT NULL DEFAULT '{}',
  budget TEXT,
  hotel_name TEXT,
  notes TEXT,
  summary TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'new',
  source VARCHAR(16) NOT NULL DEFAULT 'whatsapp',
  raw_collected JSONB NOT NULL DEFAULT '{}'::jsonb,
  quote_status VARCHAR(16),
  quote_error TEXT,
  quotes_fetched_at TIMESTAMPTZ,
  quote_search JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads (phone);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_booking_type ON leads (booking_type);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_quote_status ON leads (quote_status);

CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(32) NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts (name);


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

CREATE INDEX IF NOT EXISTS idx_flight_quotes_lead_id ON flight_quotes (lead_id);

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
  provider TEXT NOT NULL DEFAULT 'hotelbeds',
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hotel_quotes_lead_id ON hotel_quotes (lead_id);

CREATE TABLE IF NOT EXISTS admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_admin_id ON refresh_tokens (admin_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family_id ON refresh_tokens (family_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens (expires_at);

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
  children_ages INTEGER[] NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_predefined_quotes_updated_at ON predefined_quotes (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_predefined_quotes_quote_type ON predefined_quotes (quote_type);

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

CREATE INDEX IF NOT EXISTS idx_predefined_quote_items_quote_id ON predefined_quote_items (quote_id);

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS predefined_quote_id UUID REFERENCES predefined_quotes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_predefined_quote_id ON leads (predefined_quote_id);

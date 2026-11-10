# Horizon Travel — Deploy guide

**Frontend:** Vercel  
**Backend API + Postgres + Redis + BullMQ:** VPS (Docker Compose)

---

## Agency isolation model

This CRM uses **one deployment and one database per agency**. It is deliberately
not multi-tenant: there is no `tenant_id` filter whose omission could expose
another agency's leads. Every agency must have all of the following kept unique:

- Compose project name (for example `travel-acme`)
- `AGENCY_SLUG`, Postgres database/credentials, and Docker volumes
- backend/frontend domains, JWT secrets, bootstrap admin, and provider credentials
- Cloudinary folder and WhatsApp webhook destination

Create an environment from the template and launch it as its own Compose project:

```bash
cp deploy/agency.env.example /secure/path/agency-acme.env
cd backend
AGENCY_ENV_FILE=/secure/path/agency-acme.env \
  docker compose --env-file /secure/path/agency-acme.env -p travel-acme up -d --build
curl https://api-acme-travel.example.com/healthz
```

The health response includes `agency: "acme-travel"`. Confirm that value before
connecting a frontend or webhook. Compose prefixes the Postgres and Redis volumes
with the project name, so `travel-acme` and `travel-contoso` cannot share lead data.
Never point two agency frontends at the same backend URL.

For demo accounts, deploy one frontend project per agency. Update that project's
`frontend/vercel.json` API rewrite to its matching backend URL, and set the backend
`FRONTEND_URL`/`CORS_ORIGINS` to that frontend. Signing into two demo URLs will then
use independent databases, users, leads, dealers, packages, and quote history.

To operate a specific agency, always include the project and env file:

```bash
AGENCY_ENV_FILE=/secure/path/agency-acme.env \
  docker compose --env-file /secure/path/agency-acme.env -p travel-acme ps
AGENCY_ENV_FILE=/secure/path/agency-acme.env \
  docker compose --env-file /secure/path/agency-acme.env -p travel-acme logs -f backend
```

Do not run `docker compose down -v` in production; `-v` deletes that agency's
database and Redis volumes.

---

## A. Backend on VPS

### 1. Install Docker

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER
# log out / back in
```

### 2. Clone repo

```bash
git clone https://github.com/apporbitscom-cmyk/travel.git ~/travel
cd ~/travel/backend
```

### 3. Create `.env`

```bash
cp .env.example .env
nano .env
```

Important production values:

```env
POSTGRES_PASSWORD=CHANGE_ME_STRONG_PASSWORD

# Your Vercel URL(s), comma-separated
CORS_ORIGINS=https://your-app.vercel.app,http://localhost:5173
# Public CRM URL for WhatsApp quote links (required in production)
FRONTEND_URL=https://your-app.vercel.app
# Public API URL for WhatsApp PDF attachments
BACKEND_URL=https://api.example.com

WASENDER_API_KEY=...
WASENDER_WEBHOOK_SECRET=...
OPENAI_API_KEY=...
# Brochure / rate-sheet OCR model (see C4). gpt-4.1-mini is the accuracy/speed sweet spot.
OPENAI_IMPORT_MODEL=gpt-4.1-mini
# Speech-to-text for WhatsApp voice notes (see C3)
OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
RAPIDAPI_KEY=...
HOTELBEDS_API_KEY=...
HOTELBEDS_SECRET=...

# SerpApi — Google Flights (+ autocomplete), Google Hotels autocomplete, Google Images
SERPAPI_KEY=...
# Flight provider for the quote worker: auto | booking | google
FLIGHTS_PROVIDER=auto

# Cloudinary (predefined quote images)
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
CLOUDINARY_FOLDER=travel/quotes

# Admin JWT — generate with: openssl rand -hex 32
# Use DIFFERENT secrets for access vs refresh
JWT_ACCESS_SECRET=...
JWT_REFRESH_SECRET=...
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d
# Cross-site cookie for Vercel → HTTPS API:
COOKIE_SECURE=true
COOKIE_SAME_SITE=none
# Required when API is under a URL prefix (e.g. https://api.dimyon.ai/travel)
REFRESH_COOKIE_PATH=/

BACKEND_PORT=3000
```

> Compose overrides `POSTGRES_HOST` / `REDIS_HOST` to `postgres` / `redis` inside the network. You do not need to set those for Docker prod.

> `POST /api/auth/signup` creates a pending user with three lead credits. Users cannot sign in until an admin approves them in **Permission**. Set `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD_MIN_12_CHARS` on a fresh installation so the first admin is created at startup. Existing admin accounts retain their admin role.

### 4. Start backend stack

```bash
cd ~/travel/backend
docker compose up -d --build
docker compose ps
docker compose logs -f backend
```

API health check: `http://YOUR_VPS_IP:3000/`

WhatsApp webhook:

```text
http://YOUR_VPS_IP:3000/webhook/whatsapp
# or with HTTPS domain:
https://api.yourdomain.com/webhook/whatsapp
```

In the Wasender dashboard, subscribe this webhook to **`messages.received`** (and the
group/personal variants you use) **and `poll.results`**. The bot asks customers to pick a
hotel option and to accept a package with WhatsApp polls; without `poll.results` their
taps never reach the CRM (typing the option number still works).

### 5. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 3000/tcp
# if using Caddy/Nginx TLS proxy instead, allow 80/443 and bind backend to 127.0.0.1
sudo ufw enable
```

### 6. Optional HTTPS (Caddy)

Point DNS `api.yourdomain.com` → VPS, then:

```bash
# bind API to localhost only
# in backend/.env: BACKEND_PORT=3000 and change compose ports to "127.0.0.1:3000:3000"
# or keep public 3000 during testing
```

Caddyfile:

```caddy
api.yourdomain.com {
  reverse_proxy 127.0.0.1:3000
}
```

---

## B. Frontend on Vercel

1. Import the GitHub repo in Vercel.
2. Set **Root Directory** to `frontend`.
3. Framework: Vite.
4. Environment variables:

| Name | Value |
|------|--------|
| `VITE_API_URL` | **Leave unset / empty** (recommended) |

`frontend/vercel.json` already proxies `/api/*` to the VPS and rewrites SPA routes (`/login`, `/signup`) to `index.html`.

5. Deploy.

Local frontend still works with Vite proxy (`VITE_API_URL` empty).

### Auth + cookies (recommended: same-origin via Vercel proxy)

Do **not** point the browser at a separate API host for the CRM. Access tokens are memory-only; refresh uses an HttpOnly cookie. Cross-site cookies from `api.dimyon.ai` while the UI is on `*.vercel.app` are unreliable (and often blocked).

**Recommended setup**

1. On Vercel: **delete / leave empty** `VITE_API_URL` (and do not set `VITE_FORCE_ABSOLUTE_API`). The app always calls same-origin `/api/...`.
2. Keep `frontend/vercel.json` rewriting `/api/*` → `https://api.dimyon.ai/travel/api/*` (or your VPS).
3. On the VPS backend `.env`:

```env
FRONTEND_URL=https://travel-kappa-navy.vercel.app
CORS_ORIGINS=https://travel-kappa-navy.vercel.app
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
REFRESH_COOKIE_PATH=/
```

`FRONTEND_URL` is what customers get in WhatsApp quote messages. If it is missing and `CORS_ORIGINS` starts with `localhost`, links will point at localhost.

4. Redeploy the frontend after changing `vercel.json` / `api.ts`.
5. Restart backend containers after env changes.
6. Log in again once (old cookies on `api.dimyon.ai` do not apply to the Vercel host).

### Alternative: direct HTTPS API (no Vercel proxy)

Only if you set `VITE_FORCE_ABSOLUTE_API=true` and `VITE_API_URL` to the API origin:

```env
FRONTEND_URL=https://travel-kappa-navy.vercel.app
COOKIE_SECURE=true
COOKIE_SAME_SITE=none
REFRESH_COOKIE_PATH=/
CORS_ORIGINS=https://travel-kappa-navy.vercel.app
```

Browsers may still block these as third-party cookies; prefer the Vercel proxy.

---

## C. GitHub Actions (backend deploy)

| Workflow | Trigger | Action |
|----------|---------|--------|
| `.github/workflows/ci.yml` | push/PR | Backend syntax + Docker build; frontend lint/build |
| `.github/workflows/deploy.yml` | push to `main` under `backend/**` (or manual) | SSH → pull → `docker compose up -d --build` in `backend/` |

### Secrets

Repo → **Settings → Secrets and variables → Actions → Repository secrets**:

| Secret | Example |
|--------|---------|
| `VPS_HOST` | `203.0.113.10` |
| `VPS_USER` | `ubuntu` |
| `VPS_SSH_KEY` | private deploy key |
| `VPS_APP_DIR` | `/home/ubuntu/travel` |
| `VPS_PORT` | `22` (optional) |

Deploy key on VPS:

```bash
ssh-keygen -t ed25519 -C "github-deploy" -f ~/.ssh/github_deploy -N ""
cat ~/.ssh/github_deploy.pub >> ~/.ssh/authorized_keys
cat ~/.ssh/github_deploy
```

---

## C2. SerpApi (Google Flights / Hotels / Images)

Get a key at <https://serpapi.com/manage-api-key> and set `SERPAPI_KEY`. Every
call below costs one SerpApi search credit.

| Endpoint | SerpApi engine | Purpose |
|----------|----------------|---------|
| `GET /api/flights/airports?query=` | `google_flights_autocomplete` | Airport / city typeahead |
| `POST /api/flights/quotes` with `{"provider":"google"}` | `google_flights` | Flight itineraries |
| `GET /api/hotels/destinations/suggest?query=` | `google_hotels_autocomplete` | Destination / property typeahead |
| `GET /api/images/search?query=` | `google_images` | Image search (admin browsing) |
| `GET /api/images/pick?query=` | `google_images` | Best single image, usage-rights filtered |

**Credit cost.** Google Flights round trips need a second search per offer to
resolve the return legs (Google returns outbound itineraries plus a
`departure_token`). `SERPAPI_FLIGHTS_RETURN_LOOKUPS` caps how many of the
cheapest offers get resolved (default `3`, so a round-trip search costs up to
**4 credits** plus up to 2 for autocomplete). Set it to `0` to leave every offer
outbound-only.

**Flight provider fallback.** `FLIGHTS_PROVIDER` controls the quote worker:

| Value | Behaviour |
|-------|-----------|
| `auto` (default) | Booking.com first, Google Flights if it fails |
| `booking` | Booking.com only — behaviour before SerpApi existed |
| `google` | Google Flights only |

In `auto` the fallback only engages when `SERPAPI_KEY` is set, so leaving the key
unset keeps the pipeline exactly as it was. The provider that produced a lead's
quotes is recorded in `leads.quote_search.flight_provider`.

**Airport resolution.** Free text resolves to either a whole metro area or a
single airport, decided by how far apart that city's airports actually are:

| Query | Airports (miles from city) | Spread | Resolves to |
|-------|----------------------------|--------|-------------|
| `new york` | JFK 12, LGA 8, EWR 8 | 12 mi | metro — searches all three |
| `london` | LHR 14, LGW 25, LTN 27, STN 30, SEN 35 | 35 mi | metro — all sold as "London" |
| `dubai` | DXB 6, SHJ 17, **AUH 66** | 66 mi | `DXB` only — Abu Dhabi is another emirate |
| `delhi` | DEL 6 | 6 mi | `DEL` |

`SERPAPI_FLIGHTS_METRO_MAX_MI` (default `40`) is the cutoff; `0` always quotes a
single airport. `"metro": true` / `false` in the request body overrides it per
search. The resolved location returns `airport_spread_mi` and `nearby_airports`
so an agent can see what was covered. A bare IATA code (`DXB`) is used as-is and
costs no credit.

**Image licensing.** `/api/images/search` is unfiltered. `/api/images/pick` — the
one meant for auto-filling package artwork — defaults to usage-rights-filtered
results (`SERPAPI_IMAGES_LICENSES`, default `f` = free to use or share). Confirm
rights before putting any Google Images result in a customer-facing quote.

---

## C3. WhatsApp voice notes → leads

A customer can send a **voice note** instead of typing. It is transcribed and run
through the *same* intake as a typed message, so the LLM extracts destination,
dates, adults and children, asks a follow-up question for anything missing, and
creates the lead once the request is complete. Several voice notes in a row work
the same way as several texts.

```
Wasender webhook ──► voice-messages queue ──► decrypt ──► download ──► transcribe ──► lead intake
   (acks at once)        (BullMQ, 3 tries)    (Wasender)             (OpenAI)      (same as text)
```

- The webhook only recognises the voice note and enqueues it, so Wasender is
  acknowledged immediately. All slow work happens in the worker.
- Wasender sends the audio **encrypted**. The worker asks Wasender to decrypt it
  (`POST /api/decrypt-media`) and downloads the result. That link expires after
  1 hour, so it is requested fresh on every attempt and never stored.
- The customer first gets `🎤 “…what was heard…”`, so a misheard place or date is
  visible before a lead is created from it. Turn off with `VOICE_ECHO_TRANSCRIPT=false`.
- Arabic and English are detected automatically. Agents see a *🎤 Voice message ·
  transcribed* label on those messages in the inbox.

| Variable | Default | Meaning |
|----------|---------|---------|
| `OPENAI_TRANSCRIBE_MODEL` | `gpt-4o-mini-transcribe` | `gpt-4o-transcribe` is more accurate on Arabic / noisy audio |
| `VOICE_MAX_SECONDS` | `180` | longer voice notes are declined (cost / abuse guard) |
| `VOICE_ECHO_TRANSCRIPT` | `true` | reply with what was heard |
| `VOICE_WORKER_CONCURRENCY` | `1` | keep at 1: two notes from one customer update the same conversation |

**Failure handling.** Transient errors (OpenAI/Wasender 5xx, rate limits) retry up
to 3 times with backoff. Permanent ones (unsupported format, bad media) do not retry.
Either way, when it finally gives up the customer is told to type their details
instead, and the voice note is still recorded in the inbox. A retry never repeats
work that already happened: the transcript is saved on the job, the inbound message
is stored once per WhatsApp message id, and a retry first checks whether the earlier
attempt already created the lead, so a customer cannot end up with two.
Failed jobs appear in **Settings → Ops → failed queue jobs** and can be retried there.

**Test it without WhatsApp.** Open **Settings → Test WhatsApp**, then either press
*🎤 Record voice note* (microphone) or *Attach audio file*, listen to the preview and
send. It goes through the **same queue and worker** as a real voice note — transcription,
the follow-up questions, lead creation — and the chat shows what was heard and what the
customer would have been told. Nothing is sent to WhatsApp, and the same test phone
continues one conversation across several notes, exactly as a real customer's would. Use
it to check the OpenAI key, the transcription model and your queue worker without a phone.
It cannot test Wasender's media download (the one step a real voice note adds).
Test audio is kept in Redis for 15 minutes, then expires.

**Limits worth knowing**
- Only one-to-one chats are processed. Voice notes in WhatsApp **groups** are ignored
  on purpose — groups carry dealer RFQ replies, which must never become customer leads.
- Formats the transcription API cannot read (raw AMR/AAC) get the "please type" reply.
- **Set `WASENDER_WEBHOOK_SECRET`.** With it unset the webhook accepts anyone, and every
  voice note is a paid transcription.
- A customer who sends a *text* while their voice note is still processing (a few
  seconds) can be handled out of order. Rare, and the conversation merges both.

---

## C4. Brochure / rate-sheet import (OCR)

Upload a PDF or photo of a rate sheet or flyer under **Predefined packages → Import
brochure**. It is read by AI and turned into packages for an employee to review.

**One package per hotel / offer.** A 12-page rate sheet with 11 hotels now produces
**11 packages**, not one. It works in two passes:

1. **Outline** — one cheap call lists every separately sellable offer in the document
   (name, type, destination, pages) as structured JSON. Cover pages, terms and maps are
   skipped; a hotel that appears on two pages is merged.
2. **Extract** — each offer is read on its own, in parallel, with a prompt narrowed to
   that offer and its pages. Splitting the work keeps one long answer from being cut
   off at the model's output limit, which would have failed the whole import.

Each package becomes its own review item (*Package 3 of 11 · page 4*). Approve, edit or
reject them independently; nothing is published until approved. After approving one you
return to the list for the next.

- If one offer fails to extract, the others are still delivered and the failure is shown
  as a warning on the package list. If the outline finds nothing, the document is read
  as a single package (the old behaviour) rather than returning nothing.
- **Re-uploading a file** returns the packages already made from it (matched by file
  hash) without paying for OCR again. A file imported by the *old* single-package
  extractor is re-extracted instead. A failed or rejected import can also be retried.

**Choose the model deliberately.** On a 12-page, 11-hotel test sheet (44 price cells)
`gpt-4o-mini` misread 3–5 prices per run by copying a neighbouring season's value, while
`gpt-4.1-mini` and `gpt-4.1` read all 44 correctly every time. Reasoning models
(`gpt-5*`) were also correct but took ~70 s per brochure. Set `OPENAI_IMPORT_MODEL`
explicitly — it overrides the default. **OCR is not infallible: always check prices
against the source before approving.**

| Variable | Default | Meaning |
|----------|---------|---------|
| `OPENAI_IMPORT_MODEL` | `gpt-4.1-mini` | model used to read brochures |
| `BROCHURE_EXTRACT_CONCURRENCY` | `6` | parallel model calls per brochure |
| `BROCHURE_MAX_PACKAGES` | `40` | cap on packages from one file (each is a paid call) |

Cost: one outline call plus one call per package; each re-reads the document, so a
12-page file is roughly 12 calls of a few thousand tokens. A brochure takes about
15–30 s end to end.

---

## C5. Predefined package offers in chat (hotels *and* flights)

When a customer's request is complete, the system looks for a predefined package that
fits and offers it before running the normal API search. Replying **YES** attaches the
package to the lead; **NO** runs the usual search for what they asked for (flights for a
flight request, hotels for a hotel request, flights then hotels for a bundle).

| Customer asks for | Matched against | Must match |
|-------------------|-----------------|------------|
| a **hotel** | hotel packages and flight+hotel bundles | destination · check-in · check-out |
| a **flight** | flight packages and flight+hotel bundles | origin **and** destination · departure date · return date |
| a flight + hotel **package** | hotel packages and bundles | destination · dates |

- **When a package can be offered** is chosen per package (*Fixed dates* or *Period*):
  - **Fixed dates** (the default, and how every older package behaves) — the customer's
    dates must match exactly. A package for 10–20 Oct is not offered for 10–19 Oct.
  - **Period (months)** — tick the months the package runs (e.g. Jan, Feb, Oct). It is
    offered when the destination matches and **every month the trip touches** is ticked,
    whatever the days: 10–19 Oct matches an *October* package; 28 Oct – 3 Nov does not
    (November isn't ticked). Months apply to any year. Enter the stay as *nights*.
  - If both fit, the exact-date package is offered first.
- **Direction matters for flights.** A Mumbai→London package is never offered to someone
  flying London→Mumbai. Only the *outbound* leg decides the route, so mark each flight
  item's direction (**outbound** / **return**) or the return leg is ignored.
- Places match by city or airport code. A three-letter code only counts as a whole word
  (`IST` is Istanbul; "artist" is not). A customer typing a city can only match a package
  whose flights carry that city name (`departure_city` / `arrival_city`) or a package
  origin/destination, so fill those in rather than leaving only airport codes.
- A flight+hotel bundle is offered to flight requests too; a pure flight package wins a tie.
- The offer lists each leg (airline, flight number, route, times, duration, stops) and
  the price. Flight-only offers don't mention "nights".
- **Where to set it up:** Predefined packages → add flight items, set the package dates
  (or give every flight its `departure_time` date), origin and destination.
- The CRM's *Add lead* form and CSV import offer packages the same way.
- A flight lead that is offered a package can also be handled on its page in the CRM
  (*Accept package* / *Search APIs instead*); declining starts the flight search.

**Imported rate sheets** default to *Fixed dates*, so a seasonal grid is not offered to a
customer whose dates differ. To offer one in chat, open it (*Edit details*), choose
*Period (months)* and tick the months it covers.

---

## D. Local development

```bash
cd backend
npm run db:up          # postgres + redis only (docker-compose.dev.yml)
npm run dev            # API on :3000

cd ../frontend
npm run dev            # Vite on :5173, proxies /api → :3000
```

---

## E. Ops

```bash
cd ~/travel/backend
docker compose ps
docker compose logs -f backend
docker compose restart backend
git -C ~/travel pull && docker compose up -d --build
docker compose exec -T postgres pg_dump -U travel travel > backup-$(date +%F).sql
```

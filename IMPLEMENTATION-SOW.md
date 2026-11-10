# Horizon Travel CRM  
## Implementation Overview & Statement of Work

**Document type:** Client-facing implementation summary  
**Product name:** Horizon Travel  
**Audience:** Non-technical stakeholders, business owners, operations managers  
**Purpose:** Explain what was built, how the business process works, what you get, and what is out of scope

---

## 1. Executive Summary

Horizon Travel is an **internal CRM (Customer Relationship Management) system** for a travel agency. It helps your team turn WhatsApp trip requests into professional quotes — faster and with less manual work.

It is **not** a public booking website like Booking.com or Expedia. Customers do not search and pay online. Instead:

1. A customer messages the agency on **WhatsApp**
2. The system helps collect trip details (with AI assistance)
3. The system searches hotels and flights from multiple sources
4. Your agents compare options, add markup, and build a quote
5. The quote is sent to the customer as a **link + PDF** (WhatsApp and/or email)
6. The customer can open the link, review the offer, and **accept** it

Your agents stay in control of pricing, dealer negotiation, and final booking (which still happens offline / through your normal supplier process).

---

## 2. Who Uses the System

| User | How they use it |
|------|------------------|
| **Travel agents / admins** | Log into the CRM to manage leads, inbox, dealers, quotes, and settings |
| **Customers** | Chat on WhatsApp; open a public quote link to view/accept — no customer login |
| **Dealers / suppliers** | Receive price requests on WhatsApp (DM or group); replies are captured back into the CRM |

---

## 3. Business Workflow (End to End)

### Step 1 — Lead intake (WhatsApp)

- Customer messages the agency WhatsApp number
- AI helps gather trip details: hotel / flight / package, dates, destination, guests, preferences
- A **lead** is created automatically in the CRM
- Optional: if a ready-made package matches, the bot can offer it (customer replies YES/NO)

### Step 2 — Auto-sourcing

Background jobs search available options from connected suppliers:

- **Flights** — Booking.com API and/or Google Flights
- **Hotels / stays** — Hotelbeds, Booking.com, Airbnb

Results appear in the lead workspace for the agent to review.

### Step 3 — Dealer requests (optional)

- Agent sends a price request (RFQ) to dealers via WhatsApp
- Dealer replies in chat or group
- AI helps parse replies and surface the best options for review

### Step 4 — Build the quote

Agent workspace follows a clear path:

**Source → Dealers → Build → Send**

- Compare options from different sources
- Select flights/hotels/line items
- Apply markup, extras, and rounding
- Create a priced draft ready to share

### Step 5 — Send to customer

- System creates a shareable quote link
- Generates a **PDF** of the quote
- Delivers via **WhatsApp** (text + PDF) and/or **email**
- Customer opens the public page, reviews, and can **accept** (name + email)

### Step 6 — Lifecycle tracking

Each lead moves through statuses such as:

`Intake → Sourcing → Awaiting dealers → Comparing → Drafting → Ready to send → Sent → Accepted → Booked`

(Also: Lost / Archived)

> **Important:** “Booked” means your team marked the deal as booked after offline confirmation. The system does **not** automatically book tickets/rooms with airlines or hotels.

---

## 4. What Was Built (Feature List)

### 4.1 Staff CRM (login required)

| Area | What it does |
|------|----------------|
| **Login / Signup** | Secure staff access with roles: Admin or Agent |
| **Inbox** | Unified WhatsApp inbox for customers, dealers, and groups |
| **Leads** | Lists for Hotel, Flight, and Package requests; full lead detail workspace |
| **Quotes (templates)** | Predefined / reusable package templates with PDF support |
| **Dealers** | Directory of suppliers (phone, WhatsApp group, destinations/services) |
| **Contacts** | Customer contact book |
| **Settings** | Account, delivery notes, WhatsApp test tools, API sandbox, ops tools (admin) |

### 4.2 Public customer page

| Area | What it does |
|------|----------------|
| **Quote page** (`/quote/...`) | Customer views the offer, downloads PDF, accepts the quote |

### 4.3 Automation & intelligence

- WhatsApp webhook for inbound messages
- AI-assisted conversation for collecting trip fields (English / Arabic-friendly package flow)
- Automatic flight and hotel quote fetching (when API keys are configured)
- AI help parsing dealer replies and ranking options
- Quote pricing engine (markup, extras, rounding)
- Quote versioning + share tokens
- PDF generation for quotes and templates
- Optional email delivery of quotes
- Image uploads for quote/template visuals (Cloudinary)
- Admin ops view for failed jobs / delivery issues
- Audit events for important actions

### 4.4 Lead types supported

1. **Hotel only**
2. **Flight only**
3. **Package** (flights + hotels)

---

## 5. What Is Not Included (Out of Scope Today)

Share this clearly with stakeholders so expectations stay aligned:

| Not included | Why it matters |
|--------------|----------------|
| Online **payments** (Stripe, PayPal, card checkout) | Customers accept quotes; payment is handled outside the system |
| Automatic **supplier booking confirmation** | Search & quote only — final booking is manual / offline |
| Customer self-service account / itinerary app | Customers use WhatsApp + public quote link only |
| Multi-agency / multi-tenant SaaS | Built for one agency operation |
| Accounting / invoicing / ERP | Not part of this CRM |
| White-label branding beyond current Horizon UI | Branding changes can be a future phase |
| Guaranteed uptime of third-party APIs | Booking.com, WhatsApp, OpenAI, etc. depend on those providers |

---

## 6. Technology Overview (Simple Language)

You do not need to know the tech stack to run the business. This section is only for context.

| Part | Role | Typical hosting |
|------|------|-----------------|
| **Website / CRM screens** | What agents see and click | Vercel (frontend) |
| **API / brain** | Business logic, WhatsApp, searches, PDFs | VPS with Docker |
| **Database** | Stores leads, quotes, contacts, dealers | PostgreSQL |
| **Job queue** | Background hotel/flight searches | Redis |

**Security basics:** Staff passwords are encrypted; login uses secure tokens/cookies; roles separate Admin vs Agent.

---

## 7. Third-Party Services Required to Go Live

The software is built. Full live operation needs accounts/keys you (or your technical partner) configure:

| Service | Needed for |
|---------|------------|
| **Wasender (WhatsApp API)** | Receive and send WhatsApp messages / PDFs |
| **OpenAI** | AI conversation + dealer reply understanding |
| **RapidAPI — Booking.com** | Flight & hotel search |
| **RapidAPI — Airbnb** | Alternative stay options |
| **Hotelbeds** | Hotel availability / rates |
| **SerpApi** (optional) | Google Flights, autocomplete, images |
| **Cloudinary** | Uploading images for templates/quotes |
| **SMTP email** (optional) | Sending quotes by email |
| **VPS + domain** | Hosting the API and database |
| **Vercel (or similar)** | Hosting the CRM website |

Without these keys, core screens still work, but WhatsApp, AI, and live search stay limited or off.

---

## 8. Acceptance Criteria (How to Know It Works)

Use this checklist when reviewing delivery:

- [ ] Staff can sign up / log in and access the CRM
- [ ] A WhatsApp message can create or update a lead with trip details
- [ ] Hotel / flight / package leads appear in the correct lists
- [ ] When APIs are configured, search results appear for sourcing
- [ ] Agent can request prices from dealers and see replies in the CRM
- [ ] Agent can build a quote with markup and generate a PDF
- [ ] Quote can be sent via WhatsApp and/or email
- [ ] Customer can open the public link, view the quote, download PDF, and accept
- [ ] Lead status can be moved through the pipeline to Booked / Lost / Archived
- [ ] Predefined package templates can be created and shared
- [ ] Admins can review basic ops / failed delivery issues

---

## 9. Suggested Delivery Phases (For Clients & Future Work)

### Phase 1 — Foundation (done / included)

Auth, leads, contacts, hosting structure, CRM navigation

### Phase 2 — WhatsApp intake (done / included)

Webhook, AI conversation, lead creation

### Phase 3 — Auto-sourcing (done / included)

Flight & hotel background searches from multiple sources

### Phase 4 — Dealer RFQ (done / included)

WhatsApp requests, reply capture, review tools

### Phase 5 — Quote build & send (done / included)

Pricing, versions, PDF, share link, accept page

### Phase 6 — Templates & ops (done / included)

Predefined packages, settings tools, admin ops

### Phase 7 — Optional future upgrades (not included unless agreed)

- Online payments
- Real supplier booking / confirmation APIs
- Custom branding / white-label
- Advanced analytics & reporting
- Multi-branch / multi-agency support
- Customer mobile app

---

## 10. Roles & Permissions

| Role | Typical access |
|------|----------------|
| **Agent** | Day-to-day: inbox, leads, quotes, dealers, contacts |
| **Admin** | Agent access + ops / system tools |

> Production note: public signup should be restricted so random people cannot create staff/admin accounts.

---

## 11. Data the System Handles

Examples of information stored:

- Customer WhatsApp conversations and contact details
- Trip requirements (dates, destination, guests, preferences)
- Search results and quote drafts
- Dealer directory and RFQ history
- Quote versions, share links, acceptances
- Staff accounts and audit events

**Recommendation:** Keep a privacy/WhatsApp compliance policy for your market (customer consent, data retention, etc.). This document is not legal advice.

---

## 12. Support & Dependencies (Business Reality)

The CRM’s quality in production depends on:

1. Valid WhatsApp session (Wasender)
2. Active paid/developer API subscriptions where required
3. Correct hosting (frontend + backend + database + Redis)
4. SMTP setup if email quotes are required
5. Your team’s process for final booking after a quote is accepted

Third-party outages (WhatsApp, OpenAI, Hotelbeds, RapidAPI, etc.) can temporarily reduce automation until those services recover.

---

## 13. One-Page Summary for Sharing

**Horizon Travel** is a staff CRM that turns WhatsApp travel requests into priced, shareable quotes.

**In:** WhatsApp leads → AI intake → hotel/flight search → dealer RFQs → markup & PDF quote → customer accept link  

**Out:** Online payment and automatic ticket/hotel booking  

**Users:** Agents/admins in the CRM; customers on WhatsApp + public quote page  

**Value:** Faster quoting, less copy-paste, clearer pipeline, professional PDFs, one place for inbox + dealers + leads  

---

## 14. Glossary (Non-Technical)

| Term | Meaning |
|------|---------|
| **CRM** | Software your team uses to manage customers and deals |
| **Lead** | A trip request from a customer |
| **RFQ** | Request for quote — asking a dealer for a price |
| **Markup** | Extra amount you add on top of cost for profit |
| **PDF** | Downloadable document of the quote |
| **Webhook** | Automatic message from WhatsApp into the system |
| **API** | Connection to an external service (flights, hotels, AI, etc.) |
| **Pipeline / lifecycle** | Stages of a deal from first message to booked |
| **Token / share link** | Secure unique link for the customer to open their quote |

---

## 15. Document Control

| Field | Value |
|-------|-------|
| Product | Horizon Travel CRM |
| Document | Implementation Overview & SOW |
| Format | Markdown (export to PDF via any Markdown → PDF tool) |
| Intended readers | Business owners, ops managers, non-technical clients |
| Related technical docs | `DEPLOY.md` (hosting), `backend/.env.example` (keys checklist) |

---

*This document describes the product as implemented in the Horizon Travel codebase for client communication. Technical deployment steps live in `DEPLOY.md`.*

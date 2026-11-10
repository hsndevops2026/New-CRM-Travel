# Horizon Travel CRM — Product & UI/UX Design Brief

## 1. What the platform is

Horizon Travel is an internal, WhatsApp-first CRM for a travel agency. It helps travel agents turn customer trip requests into polished, priced quotations with less manual work.

The platform brings the agency's WhatsApp conversations, customer leads, supplier/dealer offers, live flight and hotel search results, quote pricing, PDFs, and customer approvals into one workspace.

It is **not a consumer booking marketplace** like Booking.com or Expedia. Customers do not browse inventory, pay, or complete a booking inside the platform. Agency staff search and compare options, build the offer, and send it to the customer. The final booking and payment happen outside the platform.

### Short product statement

> A travel-agency operations workspace that converts WhatsApp enquiries into sourced, priced, shareable travel quotations.

### Primary value

- Reduce copying and pasting between WhatsApp, spreadsheets, suppliers, and PDFs.
- Give agents one place to manage conversations, leads, suppliers, and quotes.
- Speed up hotel, flight, and package quotation creation.
- Keep the sales pipeline and next action visible.
- Present customers with a professional, mobile-friendly quote and a clear acceptance action.

---

## 2. Who uses it

### Travel agent

The primary user. An agent handles WhatsApp conversations, reviews trip requirements, sources options, asks dealers for rates, compares offers, applies markup, and sends the final quote.

### Administrator

Can do everything an agent can, plus manage agency branding and operational tools, approve staff access, allocate lead credits, and review system or delivery failures.

### Customer

Does not log into the CRM. The customer communicates through WhatsApp and opens a secure public link to review, download, and accept a quote.

### Dealer / supplier

Does not log into the CRM. A dealer receives a request for quotation through a WhatsApp direct message or group and replies there. The response is captured and shown to the agent.

---

## 3. Core business journey

1. A customer messages the travel agency on WhatsApp.
2. AI-assisted intake gathers the trip type, destination, dates, travelers, and preferences.
3. A hotel, flight, or package lead is created in the CRM.
4. Connected sources search for flights and/or hotels in the background.
5. The agent may also send RFQs to dealers through WhatsApp.
6. Supplier, API, dealer, and reusable-package options are collected for comparison.
7. The agent selects suitable items, applies markup and extras, and reviews profit margin.
8. The platform creates a locked quote version, shareable customer link, and PDF.
9. The agent sends it by WhatsApp or email and can see delivery status.
10. The customer reviews and accepts the quote.
11. The agent completes the actual booking offline and marks the lead as booked.

### Lead lifecycle

`Intake → Sourcing → Awaiting dealers → Comparing → Drafting → Ready to send → Sent → Accepted → Booked`

Alternative final states: `Lost` and `Archived`.

The UI should always make the current stage, next recommended action, and any blockers obvious.

---

## 4. Information architecture

The authenticated desktop application uses a persistent left sidebar and a top bar with contextual search and an account menu.

### Main navigation

| Area | Purpose |
|---|---|
| Inbox | Unified WhatsApp conversations with customers, dealers, and groups |
| Leads | Hotel, flight, and package enquiries and their progress |
| Quotes | Reusable quotation/package templates, not quotes for one specific lead |
| Dealers | Supplier directory and WhatsApp RFQ destinations |
| Contacts | Customer phone book |
| Settings | Account, agency branding, delivery configuration, and operator tools |
| Permissions | Staff signup approval and lead-credit allocation; admin only |

### Public route

The public customer quotation page is separate from the staff application. It needs no sidebar, account, or CRM controls.

---

## 5. Screens to design

### A. Sign in and signup

Create a focused authentication experience for staff, not customers. It should include email, password, password visibility, validation, loading, and error states. Signup may require administrator approval, so include a clear pending-approval state.

### B. Inbox

The Inbox is a high-frequency operational screen and should feel fast and familiar.

Desktop layout:

- Left column: searchable conversation list with filters for all, customers, dealers, and groups.
- Center: active WhatsApp-style conversation, message history, message composer, sending/error states, and a shortcut to the related lead.
- Right contextual pane: compact lead summary and useful actions when a conversation is linked to a lead.

Mobile layout:

- Show the conversation list first.
- Opening a conversation replaces the list.
- Provide a clear back action.
- Lead context should use a drawer or progressive disclosure rather than a permanent third pane.

Important states: unread, selected, sending, failed message, empty inbox, no filtered results, conversation without a linked lead, loading history.

### C. Leads list

Lead types are Hotel, Flight, and Package. Users switch between these segments.

The screen needs:

- Count of leads and count created today.
- Search and practical status filters.
- Table view for dense operational scanning.
- Board view organized by lifecycle stage.
- Multi-select and bulk status updates.
- Primary action to add a lead manually.
- Clear status badges, dates, destination, traveler/customer details, owner or next action, and quote progress.

On mobile, use readable lead cards instead of compressing a wide table.

### D. Lead detail workspace

This is the central and most important workflow screen.

Header content:

- Customer name and lead status.
- Trip summary, dates, travelers, and phone.
- Visual lifecycle path.
- One context-aware primary action.
- Chat toggle and overflow actions such as retry sourcing, open Inbox, mark lost, archive, and delete.

Workspace steps:

1. **Source** — show reusable package matches and flight/hotel search results, provider status, errors, and retry sourcing.
2. **Dealers** — select dealers, send an RFQ, track requests, and review dealer replies parsed into structured offers.
3. **Market** — show market-reference results that help an agent judge pricing.
4. **Build** — compare all eligible options and build pricing.
5. **Send** — create versions, generate PDF, send, and view delivery/acceptance history.

A collapsible WhatsApp chat rail remains available so the agent can reference the customer conversation without leaving the lead.

### E. Option comparison and quote builder

Comparison sources can include:

- Dealer offers.
- Live flight API results.
- Live hotel API results.
- Reusable/predefined packages.

Each option should display its source, important travel details, net cost, cancellation/validity details when available, and signals such as lowest-price rank, “Best,” or “AI pick.” Agents select one or more options to include.

The pricing panel needs:

- Currency.
- Percentage or fixed markup.
- Optional extras and an extras label, such as tax or visa fee.
- Rounding behavior.
- Quote validity date.
- Notes.
- Net total, markup, extras, selling price, gross margin, and margin percentage.
- Auto-save feedback and errors.

The design must clearly distinguish confidential internal cost/margin information from the selling price shown to the customer.

### F. Quote versioning and delivery

Agents can create an immutable version from the current draft. Each version can show:

- Version number.
- Selling price and currency.
- Draft, sent, delivered, failed, accepted, or revoked status.
- PDF action.
- Share link.
- WhatsApp/email recipient and send controls.
- Delivery history with timestamps and retry for failures.
- Customer acceptance details.

### G. Reusable Quotes library

This area stores reusable hotel, flight, and flight + hotel package templates. Avoid making it look like a history of customer quotes.

Features:

- Search templates.
- Table on desktop and cards on mobile.
- Cover image, title, type, destination/trip summary, total, and last updated.
- Create and edit a template.
- Import a PDF or image brochure for review.
- Preview, download PDF, send to dealer, and delete.
- Empty, import-processing, import-review, and error states.

### H. Dealers

A supplier directory used for RFQs. Show supplier name, phone/WhatsApp details, group connection, supported destinations/services, activity, and actions to add or edit. The interaction should make it easy to find the right dealers while working on a lead.

### I. Contacts

A lightweight customer directory optimized for phone-number and name lookup. Show contact name, WhatsApp/phone, recent interaction or related lead context, and actions to view or edit.

### J. Settings and permissions

Settings should cover:

- Staff account information.
- Agency name, logo, primary brand color, contact details, quote template, and footer.
- Quote delivery configuration and notes.
- WhatsApp connection/test tools.
- Dealer country codes and operational tools.

Permissions is admin-only and should show pending, approved, and blocked/rejected staff accounts, search, approval actions, available lead credits, and a control to add credits.

### K. Public customer quote

This is a mobile-first, trustworthy presentation page accessed through a secure link.

Content order:

1. Agency logo and branding.
2. Quote title and trip summary.
3. Destination, dates, nights, and travelers.
4. Included flight, hotel, and package items.
5. Terms or cancellation information when available.
6. Prominent final selling price.
7. Customer-facing notes.
8. Download PDF.
9. Accept form with required name and optional email.
10. Accepted confirmation and agency contact/footer information.

The acceptance copy must clarify that acceptance confirms interest and that the agency will follow up to finalize the booking. Do not imply payment or instant reservation.

---

## 6. Design direction

### Desired character

Professional, calm, efficient, trustworthy, and operational. The staff UI should prioritize information clarity over travel-poster decoration. Use travel imagery selectively in customer quotes and reusable package previews, not as a background for dense CRM screens.

### Suggested visual system

- Light neutral application background with white working surfaces.
- Dark slate text for strong readability.
- Teal/emerald as the primary brand and success family.
- Blue for informational or in-progress states.
- Amber for waiting/warnings.
- Red only for failures and destructive actions.
- Soft borders and restrained shadows; avoid excessive floating cards.
- Compact but comfortable controls suitable for all-day use.
- Rounded corners should be consistent rather than exaggerated.
- Use a modern sans-serif such as Figtree or Inter.
- Use clear icons with text labels for important actions.

The current visual foundation uses:

- Primary accent: `#0F766E`
- Main text: `#0F172A`
- Muted text: `#64748B`
- Border: `#E2E8F0`
- App background: `#F8FAFC`
- Positive tint: `#CCFBF1`

These colors may be refined, but the final system must support agency-customized branding on public quotes.

### Density and hierarchy

- CRM pages are data-rich; use consistent spacing and a strong typographic hierarchy.
- Keep the current lead stage and next action visible without scrolling where possible.
- Use badges for state, not as decoration.
- Keep a single strong primary action per page or workflow step.
- Put infrequent/destructive actions in an overflow menu.
- Avoid hiding critical price, delivery, or failure information behind hover states.

---

## 7. Responsive behavior

Design desktop and mobile states, not only a desktop frame.

- Desktop target: 1440 px wide, with a 224–240 px sidebar.
- Tablet target: around 768–1024 px.
- Mobile target: 375–430 px.
- Sidebar becomes a drawer on mobile.
- Wide tables become cards or intentionally scrollable data regions.
- Multi-column Inbox and lead-chat layouts become focused single-pane flows.
- Sticky actions may be used on mobile when they do not cover content.
- All interactive targets should be at least 44 px on touch layouts.

The interface should support English first and avoid layouts that would make future Arabic/RTL support difficult.

---

## 8. Required component system

Create reusable definitions for:

- App shell, desktop sidebar, mobile drawer, top search, and account menu.
- Page header and action group.
- Buttons: primary, secondary, ghost, danger, icon-only, loading, disabled.
- Inputs, search, select, date picker, text area, checkbox, and validation.
- Status badges and source badges.
- Filter pills and segmented controls.
- Desktop data table and mobile record card.
- Lead lifecycle stepper.
- Conversation row, chat bubble, composer, and attachment state.
- Option comparison card with selected/recommended states.
- Pricing summary and currency rows.
- Empty, loading/skeleton, error, and retry states.
- Modal, drawer, confirmation dialog, toast, and overflow menu.
- Quote template card and customer quote sections.

Accessibility requirements:

- WCAG AA color contrast.
- Visible keyboard focus.
- Do not rely on color alone for status.
- Form labels and useful error text.
- Keyboard-accessible menus, dialogs, and selection controls.
- Reduced-motion support.

---

## 9. Realistic sample data for mockups

Use realistic data rather than placeholder lorem ipsum.

### Example lead

- Customer: Sarah Ahmed
- Phone: +971 50 123 4567
- Type: Flight + Hotel package
- Route: Dubai → Istanbul
- Dates: 12–18 December 2026
- Travelers: 2 adults, 1 child
- Status: Comparing
- Preferences: 4-star hotel, breakfast included, direct flight preferred

### Example comparison options

- Turkish Airlines direct return flight — net USD 1,260
- Emirates direct return flight — net USD 1,540
- Bosphorus Grand Hotel, breakfast, refundable — net USD 720
- Sultanahmet Suites, breakfast, non-refundable — net USD 590
- Atlas Holidays dealer package — net USD 1,860 — AI pick

### Example pricing

- Net cost: USD 1,980
- Markup: 12% / USD 237.60
- Visa support fee: USD 80
- Selling price after rounding: USD 2,298
- Gross margin: USD 317.60 / 13.82%

### Example delivery

- Version: v2
- WhatsApp recipient: +971 50 123 4567
- Status: Delivered
- Valid until: 25 November 2026

---

## 10. Product boundaries — do not design these as existing features

- No online payment or checkout.
- No automatic airline ticketing or hotel reservation.
- No customer account, dashboard, or itinerary app.
- No public hotel/flight search marketplace.
- No accounting, invoicing, or ERP module.
- No advanced analytics dashboard in the current scope.
- No multi-agency SaaS administration in the current scope.

The customer accepts an offer; staff then complete payment and booking outside this platform.

---

## 11. Expected design deliverables

Please produce:

1. A small design system/style guide with tokens and component states.
2. Desktop and mobile app-shell designs.
3. High-fidelity designs for Inbox, Leads list, Lead detail/Source, Dealers, Build/Pricing, Send/Versions, Quotes library, Settings/Permissions, and the public quote.
4. Empty, loading, error, success, disabled, and destructive-confirmation states for the important flows.
5. Clickable prototype connections for the main path: Inbox → lead → source/dealer comparison → price → send → customer accept.
6. Developer-ready annotations for responsive behavior and interactions.

Prioritize the Lead detail, quote builder, and Inbox because they carry most of the product's daily value.

---

## 12. Copy-ready prompt for Claude

```text
Act as a senior product designer. Design a responsive, production-ready UI/UX for “Horizon Travel,” an internal WhatsApp-first CRM for a travel agency.

Read this entire brief before designing. Preserve the described roles, workflow, screens, data, and product boundaries. This is not a public travel-booking website. Staff turn WhatsApp enquiries into sourced, priced quotations; customers only chat through WhatsApp and open a public quote link to review, download, and accept. Payment and final booking happen offline.

Start by defining the information architecture, design tokens, and reusable component system. Then design the key desktop and mobile screens. Give the lead-detail workspace, option comparison, pricing, quote version/delivery flow, Inbox, and public customer quote the most attention.

The UI should feel professional, calm, fast, data-aware, accessible, and suitable for all-day agency operations. Use realistic sample data from this brief. Show loading, empty, error, sending, delivered, failed, accepted, and permission states. Explain important responsive and interaction decisions. Do not invent payments, automatic booking, a customer dashboard, or unrelated analytics.
```


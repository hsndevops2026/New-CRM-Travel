# Align Quotes “package” copy with Flight + Hotel

Written against: `ab4658ceacf2722cdddda241faf336570329d9b8` (working tree already sets `quoteTypeLabel('package')` → `Flight + Hotel`)

## Evidence chain

- Surface: `/quotes` list header, empty state, type badges, create-type cards, and import-review chrome
- Problem: The same quote type is shown as **Flight + Hotel** in badges/type cards and as **package** in page subtitle, empty state, and several import-review strings.
- Design evidence: Direct user-facing contradiction within one task. Canonical UI label is `quoteTypeLabel` in `frontend/src/lib/predefinedQuotes.ts` (`package` → `Flight + Hotel`) and the create modal option label `Flight + Hotel`.
- Owner: `frontend/src/lib/predefinedQuotes.ts` → `quoteTypeLabel`
- Scope and affected surfaces: `QuotesPage.tsx`, `PredefinedQuotesPanel.tsx`, `ImportPredefinedQuoteModal.tsx` (predefined-quote wording only)
- Uncertainty: none for type naming; brochure batch strings (“Package N of M”) are a different concept and must stay

## Design decision

Wherever Quotes UI means persisted `quote_type: 'package'` (or “create/update a predefined quote of that kind”), use the same language as `quoteTypeLabel('package')`: **Flight + Hotel**. Prefer calling the artifact a **quote** when the sentence is about saving a predefined quote, not about a brochure offer batch. Do not rename the API enum `package`.

## Reuse

- `quoteTypeLabel` — `frontend/src/lib/predefinedQuotes.ts`
- Type-card copy already correct: `QUOTE_TYPE_OPTIONS` in `PredefinedQuoteModal.tsx` (`label: 'Flight + Hotel'`)
- Exemplar: list `TypeBadge` already renders `quoteTypeLabel(type)`

No new primitive. Prefer `quoteTypeLabel('package')` in JS strings when building labels dynamically; hardcode the same words only in static JSX that cannot call the helper cleanly.

## Changes

1. `frontend/src/pages/QuotesPage.tsx`
   - Change: Subtitle from `Reusable hotel, flight, and package templates.` to `Reusable hotel, flight, and flight + hotel templates.`
   - Preserve: Title `Quotes`, header actions
   - Verify: Header copy matches badge vocabulary

2. `frontend/src/components/PredefinedQuotesPanel.tsx`
   - Change:
     - EmptyState `description` from `Create a hotel, flight, or package template to reuse on leads.` to `Create a hotel, flight, or flight + hotel template to reuse on leads.`
     - Import-review modal props: `title="Review AI-imported package"` → `title="Review AI-imported quote"`; submit labels `Approve and update package` / `Approve and create package` → `Approve and update quote` / `Approve and create quote`
   - Preserve: `TypeBadge` styles and `quoteTypeLabel` usage; brochure return-to-import behavior
   - Verify: Empty state and import-review chrome never say “package” for the quote type

3. `frontend/src/components/ImportPredefinedQuoteModal.tsx`
   - Change: Select option `Create a new predefined package` → `Create a new predefined quote`; fallback `Package title needs review` → `Quote title needs review` (missing extracted title for a predefined quote draft)
   - Preserve: `importBatchLabel` (“Package N of M”), count copy about brochure packages (“Found N packages in this brochure…”), comments, reject/upload flows
   - Verify: Existing `ImportPredefinedQuoteModal.test.tsx` still matches batch labels; update only assertions that target the renamed select/fallback strings if any

4. Do **not** change: `quote_type` storage value `'package'`; `importBatchLabel`; placeholders like `Dubai family package` / `What this package includes` (generic English, not the type name); lead badges outside `/quotes` (out of this plan’s audited surface)

## Scope

- Inherit: Any Quotes UI that surfaces type or create/approve wording for predefined quotes
- Verify: Search still finds quotes when users type `package` (search includes raw `quote_type`) and when they type `flight + hotel` (includes `quoteTypeLabel`)
- Exclude: ModalDrawer migration (separate plan); empty-state Button swap (separate plan); PDF/backend strings; LeadBadges `flight+hotel`

## Validation

- Product: On `/quotes`, package-type cards show **Flight + Hotel**; page subtitle and empty state use **flight + hotel**; import review/approve chrome says **quote**, not **package**
- Interface: List with a package-type demo quote; empty list; import dialog select + review modal title/submit
- System: `quoteTypeLabel('package')` remains the single canonical type label
- Repository: `cd frontend && npm test -- --run src/lib/predefinedQuotes.test.ts src/components/ImportPredefinedQuoteModal.test.tsx` → pass after any assertion updates

## Stop conditions

- Stop if product owners insist “package” remain the customer-facing type name (would require reverting `quoteTypeLabel` instead — different decision, do not mix).
- Stop if a string clearly refers to brochure multi-offer batches; leave those as “package”.

## Design documentation

- After acceptance: Record that Quotes UI labels `quote_type: package` as **Flight + Hotel** via `quoteTypeLabel`, in surface-local notes or `UI-UX-AUDIT.md` if that file is maintained for current contracts.

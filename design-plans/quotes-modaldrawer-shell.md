# Use ModalDrawer for Quotes create, edit, and preview dialogs

Written against: `ab4658ceacf2722cdddda241faf336570329d9b8` (working tree also has uncommitted Quotes modal changes; re-open cited files before editing)

## Evidence chain

- Surface: `/quotes` → `QuotesPage` → `PredefinedQuotesPanel` → `PredefinedQuoteModal` (create/edit/import review) and `PredefinedQuotePreview` (read-only)
- Problem: Create/edit/preview still use hand-rolled `fixed inset-0 … bg-black/40` shells while the same Quotes task’s import dialog already uses `ModalDrawer` (`bg-black/50`, Escape, focus trap, shared header/footer).
- Design evidence: `UI-UX-AUDIT.md` Quotes row (“quote dialogs use the improved shared dialog”); shared-dialogs row (Escape/focus); owner `frontend/src/components/ui/ModalDrawer.tsx`
- Owner: `frontend/src/components/ui/ModalDrawer.tsx`
- Scope and affected surfaces: `frontend/src/components/PredefinedQuoteModal.tsx`, `frontend/src/components/PredefinedQuotePreview.tsx` (opened from `PredefinedQuotesPanel.tsx`)
- Uncertainty: none for shell migration; form submit must follow the `AddLeadModal` `form` + `footer` pattern because `ModalDrawer` isolates footer outside the scroll body

## Design decision

Replace the custom overlay/panel chrome in `PredefinedQuoteModal` and `PredefinedQuotePreview` with `ModalDrawer`. Keep all quote form fields, type selector, validation, and preview content. Route Cancel/Save (and Edit/Download) through `ModalDrawer`’s `footer` using shared `Button`, matching Quotes import and Add Lead.

## Reuse

- `ModalDrawer` — `frontend/src/components/ui/ModalDrawer.tsx`
- `Button` (`variant="secondary"` / `variant="primary"`) — `frontend/src/components/ui/Button.tsx`
- Exemplar (Quotes): `frontend/src/components/ImportPredefinedQuoteModal.tsx` (`maxWidthClassName="max-w-3xl"`)
- Exemplar (footer + form id): `frontend/src/components/AddLeadModal.tsx` (`form="add-lead-form"`, footer `Button type="submit" form=…`)

No new primitive. If `max-w-4xl` is required for the create form, pass it via existing `maxWidthClassName`; do not fork ModalDrawer.

## Changes

1. `frontend/src/components/PredefinedQuoteModal.tsx`
   - Change: Remove the outer `fixed inset-0 …` / inner panel / custom ✕ header / sticky footer wrapper. Render `ModalDrawer` with:
     - `open={open}`
     - `title={title || (quote ? 'Edit quote' : 'Create quote')}`
     - `subtitle` = the existing status line (`quoteTypeLabel(selectedType) · …`)
     - `onClose={onClose}`
     - `maxWidthClassName="max-w-4xl"`
     - `footer`: Cancel `Button` + primary Save `Button` with `type="submit" form="predefined-quote-form"` (or equivalent stable id), disabled/saving labels unchanged
     - `children`: a `<form id="predefined-quote-form" onSubmit={submit}>` containing the current fields, type selector, hotel/flight sections, and inline error (error may sit at bottom of children or above footer actions inside footer — prefer children end so footer stays action-only like Add Lead)
   - Preserve: All draft state, type switching, return-flight toggle, validation, API save path, import-review props (`title`, `submitLabel`, `onSubmitInput`, `initialQuote`, `draftKey`)
   - Verify: Escape closes; backdrop click closes; Tab cycles within dialog; Save still submits; create and import-review titles still override

2. `frontend/src/components/PredefinedQuotePreview.tsx`
   - Change: Same shell migration. `ModalDrawer` with `title={quote.title}`, `subtitle={`${quoteTypeLabel(quote.quote_type)} quote`}`, `maxWidthClassName="max-w-3xl"`, footer Edit (`Button` secondary) + Download (`Button` primary; keep downloading disabled/label). Body = existing cover, trip meta, hotels, flights, total, notes, error.
   - Preserve: Download/PDF behavior, Edit callback, hotel location / flight direction display
   - Verify: Preview opens from list actions; Edit closes preview path unchanged from panel; Escape closes

3. Do not change `ImportPredefinedQuoteModal.tsx` (already correct) or `ModalDrawer.tsx` unless a blocking API gap appears; stop and reassess rather than inventing props.

## Scope

- Inherit: Any open state driven by `PredefinedQuotesPanel` (create, edit, import approve, preview)
- Verify: Mobile bottom-sheet rounding still comes from ModalDrawer; long forms scroll inside ModalDrawer body
- Exclude: Lead-detail quote builders, unused `QuoteDraftModal` / `CustomQuotesModal` / `ViewQuotesModal`, brochure import extraction logic, finding #2/#3 copy and empty-state Button (separate plans)

## Validation

- Product: On `/quotes`, open Create quote, Edit, Preview, and Import → Review fields; each dialog uses shared overlay (`bg-black/50`), shared close control, Escape to dismiss, primary actions in footer
- Interface: Desktop and narrow viewport; long Flight + Hotel form with return enabled; import-review with custom title/submitLabel
- System: No remaining hand-rolled overlay in these two files; footers use `Button`
- Repository: `cd frontend && npx tsc --noEmit` → clean; `cd frontend && npm test -- --run src/components/ImportPredefinedQuoteModal.test.tsx src/lib/predefinedQuotes.test.ts` → pass (import flow still opens ModalDrawer + review modal)

## Stop conditions

- Stop if `ModalDrawer` cannot host a submitting form without breaking Escape/focus (then extend ModalDrawer minimally with documented props — do not leave a parallel shell).
- Stop if product intent requires the preview eyebrow *above* the title as a distinct pattern; do not invent a ModalDrawer variant without a second consumer.

## Design documentation

- After acceptance and validation: In `UI-UX-AUDIT.md` Quotes row, note that create/edit/preview now share `ModalDrawer` with import (or none if the audit stays historical-only).

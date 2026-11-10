# Use shared Button for Quotes empty-state Create quote CTA

Written against: `ab4658ceacf2722cdddda241faf336570329d9b8`

## Evidence chain

- Surface: `/quotes` empty list (`PredefinedQuotesPanel` when `quotes.length === 0`)
- Problem: The same primary action label **Create quote** uses `Button variant="primary"` in the page header but a hand-rolled accent `button` in the empty state.
- Design evidence: Direct presentation contradiction for one action on one page. Shared owner is `frontend/src/components/ui/Button.tsx`. Header already consumes it from `QuotesPage.tsx`.
- Owner: `frontend/src/components/ui/Button.tsx`
- Scope and affected surfaces: `frontend/src/components/PredefinedQuotesPanel.tsx` empty-state `action` only
- Uncertainty: none

## Design decision

Replace the empty-state raw button with the shared `Button` primary variant so both Create quote entry points share one visual contract.

## Reuse

- `Button` with `variant="primary"` (default `size="md"`) — `frontend/src/components/ui/Button.tsx`
- Exemplar: `frontend/src/pages/QuotesPage.tsx` header action  
  `<Button variant="primary" onClick={() => setEditorOpen(true)}>Create quote</Button>`
- Composition: `EmptyState` `action` prop already accepts `ReactNode` — pass `<Button …>` as today

No new primitive.

## Changes

1. `frontend/src/components/PredefinedQuotesPanel.tsx`
   - Change: Import `Button` from `./ui/Button`. In the `EmptyState` `action`, replace:
     ```tsx
     <button
       type="button"
       className="rounded-lg bg-shop-accent px-3 py-2 text-sm font-semibold text-white"
       onClick={() => onEditorOpenChange(true)}
     >
       Create quote
     </button>
     ```
     with:
     ```tsx
     <Button type="button" variant="primary" onClick={() => onEditorOpenChange(true)}>
       Create quote
     </Button>
     ```
   - Preserve: EmptyState title/description (description may be updated by the Flight + Hotel label plan — do not fight that plan); `onEditorOpenChange(true)` behavior
   - Verify: Empty state CTA matches header Create quote styling (teal primary, same radius/padding/type scale from `Button`)

## Scope

- Inherit: Quotes empty state only
- Verify: Header Create quote unchanged; filtered-empty (“No quotes match this search”) unchanged
- Exclude: ModalDrawer migration; package/Flight + Hotel copy; other empty states outside Quotes

## Validation

- Product: With no predefined quotes, empty-state Create quote looks like the header primary button and opens the editor
- Interface: `/quotes` empty; click empty-state CTA
- System: No local `bg-shop-accent` CTA left in this empty state
- Repository: `cd frontend && npx tsc --noEmit` → clean

## Stop conditions

- Stop if `EmptyState` begins wrapping actions in styles that conflict with `Button` (fix `EmptyState` first; do not restyle Button).

## Design documentation

- None required beyond optional note that Quotes CTAs use shared `Button`.

# Raise selection-control touch targets to 44px

Written against: `65fddd71bb745fd84e64dc16cd9109fd28e7ecbf`

## Evidence chain

- Surface: Staff CRM selection controls on touch viewports — `FilterPills`, `SegmentedControl`, and lead workspace step tabs on `/leads/:id`
- Problem: On small/touch breakpoints these controls render shorter than 44px (`max-sm:h-10` = 40px; lead tabs `max-md:h-9` = 36px), while the shared `Button` md size and the product brief require 44px touch targets.
- Design evidence:
  - `CLAUDE_DESIGN_BRIEF.md` §7: “All interactive targets should be at least 44 px on touch layouts.”
  - `frontend/src/components/ui/Button.tsx` comment and `sizeStyles.md`: “controls are 36px on desktop and 44px on touch screens” → `max-sm:h-11`
  - `frontend/src/components/leads/LeadWorkspaceTabs.tsx` file comment: “Underline-style tabs (design: 44px, 2px teal rule on the current one)”
- Owner: `frontend/src/components/ui/FilterPills.tsx`, `frontend/src/components/ui/SegmentedControl.tsx`, `frontend/src/components/leads/LeadWorkspaceTabs.tsx`
- Scope and affected surfaces: Every page that mounts FilterPills or SegmentedControl (Contacts, Inbox filters, Leads list segments, etc.) and the lead detail step strip
- Uncertainty: none for height; underline thickness (`3px` vs documented `2px` on lead tabs) is out of scope unless the executor confirms the comment is still binding for stroke width

## Design decision

Match the established `Button` md touch height (`h-11` / 44px) on FilterPills, SegmentedControl, and LeadWorkspaceTabs at their existing mobile breakpoints. Do not change desktop heights, active styles, or labels.

## Reuse

- Touch height class: `h-11` (44px), same as `Button` `sizeStyles.md` → `max-sm:h-11`
- Exemplar: `frontend/src/components/ui/Button.tsx` lines 28–31
- No new primitive

## Changes

1. `frontend/src/components/ui/FilterPills.tsx`
   - Change: On the pill `button` className, replace `max-sm:h-10` with `max-sm:h-11`
   - Preserve: Desktop `h-[30px]`, pressed styles, count chip, labels
   - Verify: At a ≤640px viewport, each filter pill is 44px tall

2. `frontend/src/components/ui/SegmentedControl.tsx`
   - Change: On the tab `button` className, replace `max-sm:h-10` with `max-sm:h-11`
   - Preserve: Desktop `h-[30px]`, selected white chip, arrow-key behavior, counts
   - Verify: At a ≤640px viewport, each segment is 44px tall

3. `frontend/src/components/leads/LeadWorkspaceTabs.tsx`
   - Change: On the step `button` className, replace `max-md:h-9` with `max-md:h-11`. Optionally align desktop `md:h-10` → `md:h-11` so the file’s “44px” comment matches desktop too; if desktop density must stay, only change the `max-md` height
   - Preserve: Number badge, underline active rule on `md+`, mobile pill/border treatment, StatusBadge chips
   - Verify: Below the `md` breakpoint, each lead step control is 44px tall; scrolling still works horizontally

## Scope

- Inherit: Contacts filters, Leads segment control, Reminders/Inbox filter strips, Lead detail workspace tabs
- Verify: Visual regression on `/contacts`, `/leads/hotel`, and an open lead detail on a 390px-wide viewport
- Exclude: `Button` `sm` (`max-sm:h-10`), `StagePath` chips, icon-only header buttons already at `size-11`, sidebar collapse control, underline stroke width

## Validation

- Product: On a phone-sized viewport, tap FilterPills, SegmentedControl, and lead step tabs without missing the hit area
- Interface: `/contacts`, `/leads/hotel`, `/leads/hotel/:id` (or equivalent lead route); English and Arabic; horizontal overflow of many lead steps still scrolls
- System: Heights match `Button` md touch size; no parallel “compact mobile control” pattern introduced
- Repository: `cd frontend && npm test -- --run src/components/ui/designSystem.test.tsx src/components/ui/FilterPills.tsx` (and any existing LeadWorkspaceTabs / SegmentedControl tests) → pass

## Stop conditions

- Stop if product docs or design intentionally keep denser-than-44px mobile chips (document that exception instead)
- Stop if changing lead tab height breaks the underline/`after:-bottom-2.5` alignment — adjust only the bottom offset as needed to keep the teal rule under the tab, without redesigning the tab pattern

## Design documentation

- After acceptance: none required in `CLAUDE_DESIGN_BRIEF.md` (rule already stated in §7). Optional: update `LeadWorkspaceTabs` comment if desktop height stays at 40px so the “44px” claim applies to touch only

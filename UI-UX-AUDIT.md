# UI and UX audit

Audited the route map, page components, shared controls, loading and error states, mobile layouts, keyboard behavior, and customer quote output. The changes below are implemented in the current working tree.

| Page / flow | Finding | Improvement |
| --- | --- | --- |
| Shared app shell | Global search appeared on pages it could not filter; navigation and focus feedback were weak. | Search is limited to supported list pages, clears when moving between pages, and uses a descriptive label. Navigation and focus states are clearer. |
| Login | Password entry could not be checked, and failures were visually easy to miss. | Added password visibility control and announced error state. |
| Signup | The approval wait and initial credit allowance were unclear. | Added approval and credit guidance, password visibility, and announced errors. |
| Inbox, conversation list | Empty search results looked like an empty inbox. | Added contextual empty messages for search and thread filters. |
| Inbox, conversation | Failed sends could erase the draft; polling could jump the reader to the latest message; thread switches could leave old content visible. | Drafts persist on failure, an inline error appears, scroll stays put while reading history, and thread state resets on navigation. Mobile list/chat switching is consistent. |
| Hotel, flight, and package lead lists | Counts and selections could be misleading across filters; CSV export did not reliably match the view. | Added segment counts, scoped selections, filtered CSV export, clearer empty and retry states, and bulk action errors. |
| Lead detail, all workflow tabs | Back navigation did not return to the proper segment; active workflow step and pending actions were unclear. | Back goes to the matching lead list; active steps and pending builder/send actions have clear feedback. |
| Market references tab | Search dates were hidden in lead data and a zero result search had no explanation. | Added editable dates, traveler context, source reset behavior, and a no results message. |
| Quotes | Shared search, header hierarchy, and dialog behavior needed consistency. | Search is contextual, the header and action are clearer, and quote dialogs use the improved shared dialog. |
| Dealers | Search with no matches resembled an empty database; unmatched section needed clearer state. | Added counts, contextual empty and retry states, and expanded state for the unmatched control. |
| Contacts | Search with no matches resembled an empty database. | Added counts, contextual empty and retry states. |
| Settings | Its search control had no filtering behavior. | Removed the nonfunctional search from this route through the shared shell. |
| Permissions | Loading appeared as an empty request list; status and remaining credits were hard to scan. | Added loading state, status totals and filter, email search, pending-first order, credit usage, operation feedback, and conditional empty state. |
| Public quote and PDFs | Shared quotes and PDFs exposed internal net cost and markup; the accept button submitted twice. | Public responses and every PDF path use an allowlisted customer snapshot; the form has one submit path. |
| Shared dialogs, tables, buttons, and empty states | Keyboard navigation and state feedback varied between pages. | Added dialog focus management, Escape/Tab handling, row interaction guards, visible focus styles, and consistent visual hierarchy. |

## Verification

- Frontend build, lint, and 23 frontend tests passed after the changes.
- Backend suite passed: 75 tests, including a customer quote data sanitization test.
- `git diff --check` passed.

Browser surfaces were unavailable in this session, so responsive and visual checks were performed from component and CSS review. A device/browser pass remains useful before release.

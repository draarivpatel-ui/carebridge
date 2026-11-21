# Design: CareBridge

A warm, editorial care worksheet. The design treats a stressful job, dividing a
week of care logistics, like a well-set page in a family ledger: paper under
the hand, quiet rules and hairlines, and one loud color used only when
something is truly unstaffed.

All data is synthetic. The palette, the marks and the copy exist to make a demo
feel trustworthy without pretending to be a medical product.

## Palette

| Token | Value | Use |
| --- | --- | --- |
| `--cream` | `#f6f1e4` | canvas |
| `--wash` | `#efe7d2` | faint warm wash at the page edge (a fixed radial, not a card) |
| `--paper` | `#fbf7ec` | working surfaces: week board, binder sheet, timeline |
| `--ink` | `#1e3729` | deep evergreen: text, the mark, primary actions |
| `--ink-soft` | `#52614f` | secondary text, labels |
| `--sage` | `#e4ead8` | structural panels: the care circle, notice strips |
| `--line` / `--line-strong` | `#d9d1bb` / `#b3a98d` | hairlines and rules |
| `--coral` | `#b0492e` | real gaps only: uncovered jobs on the board, flag markers on the med axis |

The coral rule is strict. Warnings, urgent results and flags for the care team
are drawn in evergreen weight and structure, never coral, so a coral mark
anywhere on the page always means nobody is covering this.

## Type

- Display: `Iowan Old Style`, `Palatino Linotype`, `Palatino`, `Georgia`; an
  expressive serif voice for titles, dates and metric values.
- UI text: `Avenir Next`, `Segoe UI`, `Candara`, `system-ui`; a humanist sans
  for controls and body copy.
- All times and counts run `font-variant-numeric: tabular-nums` so the board
  reads like a ledger.
- Headings carry their own weight: no eyebrows, kickers or taglines anywhere.

## Marks

The bridge mark is a bespoke inline SVG (deck, hanging arch, suspenders, two
water dashes) stroked in evergreen. The same drawing is the favicon on a cream
rounded square. No icon fonts, no emoji, no external assets.

## Layout

- Contained masthead (max-width 1180px): brand left; `Synthetic demo` pill,
  live connection and offline status, and the shortcut-key toggle right; a
  segmented group of exactly four workbench buttons below, the active one
  filled evergreen (`aria-current="page"`).
- The care week (default view): an editorial metrics strip (coverage, primary
  time returned, Workload Gini first pass to balanced, separated by hairlines), then a
  paper-like seven-day grid. Day columns have hairline separators, small-caps
  weekday over a serif date, and concrete entries: time range, role, assignee
  dot in the caregiver's own color. Uncovered jobs sit on a coral wash with an
  italic line saying exactly why (no one free, missing skills, cap or rest).
  To the right, the tall sage care circle column: per person, two thin
  comparison strokes (pale for the first pass, dark for the balanced plan)
  over real minute counts, plus a native "sits out" checkbox that recomputes
  the plan without losing focus.
- The check-in: the persistent fictional/emergency notice as a sage strip, the
  form on the left (severe signs, the reading, context, editable three-day
  severity), and on the right the result panel, a teaching block that separates
  "call on the first reading" from the formal one-hour oral definitions, and a
  session log. An emergency result inverts to a cream-on-evergreen panel: the
  loudest treatment on the page, still inside the palette.
- The medicine day: context checkboxes and the add-entry form left; a drawn
  24-hour SVG axis (attribute-positioned ticks, hollow planned / filled logged
  markers, coral diamonds over flagged entries, dashed temp-check line) plus
  the entry list right, then flags for the care team.
- The handoff: person and language controls, the live binder as a real sheet
  (double-rule head, three-column task table, notes, warning foot), then the
  seal-link row with its AES caveat and the export row.

## Motion

One authored moment: week-board entries settle in with a short staggered rise
on every recompute, inside `prefers-reduced-motion: no-preference`. Nothing
else animates; hover states are 120 ms color fades.

## Responsive

Under 1020 px the care circle drops below the board. Under 860 px the grid
becomes stacked day rows (header left, jobs right), the metrics strip goes
vertical, and the two-column sheets collapse. No horizontal overflow anywhere.

## Print

`@media print` shows only `#binder`: the sheet alone on a single page, unboxed,
with constrained row padding and `break-inside: avoid` on rows and notes.
`#handoff` is force-shown so printing works even if another view was active.

## Constraints honored

- No inline scripts, no `style` attributes, no DOM injection sinks. Every
  dynamic node is built with `createElement` or `createElementNS` and
  `textContent`; all data-dependent geometry (strokes, the med axis) is set
  through SVG attributes and CSS classes.
- CSP in a meta tag: `default-src 'none'; script-src 'self'; style-src 'self';
  img-src 'self'; font-src 'self'; worker-src 'self'; connect-src 'none';
  base-uri 'none'; object-src 'none'; form-action 'none'`. Referrer is
  `no-referrer`, robots `noindex`. No external requests of any kind; downloads
  are same-origin Blob objects.
- Native controls throughout: real checkboxes, selects, buttons, `aria-current`
  on nav, `role="status"` live regions for results and announcements.

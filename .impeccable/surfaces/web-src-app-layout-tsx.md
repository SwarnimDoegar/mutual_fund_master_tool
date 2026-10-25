---
version: 1
slug: "web-src-app-layout-tsx"
primary_target: "web/src/app/layout.tsx"
related_targets: ["web/src/app"]
---

# Fund Lens web UI

Scope: every page of the web UI (home, screener, categories, fund houses, funds, fund page, compare, learn). Visitor mode: Operate (Read on /learn).
Audience and job: DIY investors, data-heavy enthusiasts and advisors shortlist, compare and study funds by their numbers.
Constraints: page structure, URLs and sections stay; light and dark themes follow the OS; green gains, red losses; server-rendered, light client JS.

## Direction contract

THESIS: The fund research standard played straight at full craft, sitting alongside Koyfin and Value Research Online. It refuses the generic SaaS kit: centred hero, ghost-button rows, stat tiles, same-radius cards everywhere, arrow-suffixed links, a stock blue.

OWN-WORLD: A navy app bar (#0F172A) over a cool white ground; white data panels with 1px rules, 6px radius, a header strip with the title and its controls, no shadows. Source Sans 3 for everything, tabular figures, 13–14px dense tables with sortable headers. Deep research blue for links and selection only; green and red only for signed numbers.

STORY: A visitor finds a fund or category in seconds, reads its numbers at a glance against peers, and drills down without hunting.

FIRST VIEWPORT: App bar with mark, nav and search; a left-aligned one-line title and description; an inline facts row (schemes, active, peer-ranked, categories, NAV date); category leader panels in a three-column grid, each a compact table.

FORM: canon (category standard), chosen by the user over the rolled direction; seed: 465d71a589d0cee7.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

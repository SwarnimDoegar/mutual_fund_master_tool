---
name: Fund Lens
description: Indian mutual fund research, every scheme measured from published NAVs; the category standard played straight at full craft.
colors:
  # Light theme (default). Source: web/src/app/globals.css :root
  bg: "#f4f6f9"
  surface: "#ffffff"
  surface-2: "#eff2f6"
  border: "#dde2e9"
  border-strong: "#c2c9d4"
  text: "#0f172a"
  muted: "#536074"
  faint: "#7a8597"
  brand: "#1f4fbf"
  brand-soft: "#e8eefb"
  on-brand: "#ffffff"
  pos: "#08743f"
  neg: "#c4261d"
  warn: "#9a5b00"
  shell: "#0f172a"
  shell-2: "#1e293b"
  shell-border: "#334155"
  shell-text: "#e2e8f0"
  shell-muted: "#9aa8bc"
  series-1: "#1f4fbf"
  series-2: "#d9730d"
  series-3: "#0f8b7e"
  series-4: "#8b3fc4"
  series-5: "#c2305f"
  # Dark theme, applied under prefers-color-scheme: dark (same variable names)
  bg-dark: "#0e131a"
  surface-dark: "#141a22"
  surface-2-dark: "#1a222c"
  border-dark: "#252f3c"
  border-strong-dark: "#354253"
  text-dark: "#e6eaf0"
  muted-dark: "#9aa6b6"
  faint-dark: "#6f7b8c"
  brand-dark: "#82a8ff"
  brand-soft-dark: "#1a2742"
  on-brand-dark: "#0b1220"
  pos-dark: "#3fc685"
  neg-dark: "#ff6b61"
  warn-dark: "#e0a243"
  shell-dark: "#090d13"
  shell-2-dark: "#161d27"
  shell-border-dark: "#2a3443"
  shell-text-dark: "#e2e8f0"
  shell-muted-dark: "#8d9bb0"
  series-1-dark: "#82a8ff"
  series-2-dark: "#f0a050"
  series-3-dark: "#3fd0bb"
  series-4-dark: "#c58af0"
  series-5-dark: "#ff7aa2"
typography:
  display:
    fontFamily: "Source Sans 3, ui-sans-serif, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.25
  title:
    fontFamily: "Source Sans 3, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.375
  body:
    fontFamily: "Source Sans 3, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
  table:
    fontFamily: "Source Sans 3, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.43
    fontFeature: "tnum"
  control:
    fontFamily: "Source Sans 3, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.45
  label:
    fontFamily: "Source Sans 3, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.33
  figure:
    fontFamily: "Source Sans 3, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.375
    fontFeature: "tnum"
  figure-lead:
    fontFamily: "Source Sans 3, ui-sans-serif, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.25
    fontFeature: "tnum"
  chart-axis:
    fontFamily: "Source Sans 3, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
  formula:
    fontFamily: "ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
rounded:
  control: "4px"
  panel: "6px"
spacing:
  hair: "4px"
  sm: "8px"
  cell-y: "7px"
  cell-x: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  app-bar:
    backgroundColor: "{colors.shell}"
    textColor: "{colors.shell-text}"
    height: "56px"
  app-bar-link:
    textColor: "{colors.shell-muted}"
  app-bar-link-hover:
    textColor: "#ffffff"
  app-bar-search:
    backgroundColor: "{colors.shell-2}"
    textColor: "{colors.shell-text}"
    rounded: "{rounded.control}"
    height: "32px"
    padding: "0 10px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    padding: "{spacing.md}"
  panel-head:
    typography: "{typography.title}"
    padding: "10px 16px"
  table-header:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    padding: "8px 12px"
  table-cell:
    typography: "{typography.table}"
    padding: "7px 12px"
  table-row-hover:
    backgroundColor: "{colors.surface-2}"
  button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    height: "32px"
    padding: "0 12px"
  button-hover:
    backgroundColor: "{colors.surface-2}"
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.on-brand}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    height: "32px"
    padding: "0 12px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    height: "32px"
    padding: "0 10px"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "2px 8px"
  badge:
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "1px 6px"
  badge-brand:
    textColor: "{colors.brand}"
  segmented-option:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    padding: "4px 10px"
  segmented-option-selected:
    backgroundColor: "{colors.text}"
    textColor: "{colors.surface}"
  tab:
    textColor: "{colors.muted}"
    padding: "10px 0"
  tab-hover:
    textColor: "{colors.text}"
  stat-figure:
    textColor: "{colors.text}"
    typography: "{typography.figure}"
---

# Design System: Fund Lens

## Overview

**Creative North Star: "The Research Terminal, Played Straight"**

Fund Lens is the category standard for fund research executed at full craft: the visual grammar a reader of Koyfin or Value Research Online already knows, with nothing reinvented and nothing left loose. A navy app bar sits over a cool white ground; everything below it is a white data panel ruled with 1px lines, headed by a strip that carries the panel's title and its own controls. Numbers are the product, so type is one family, figures are tabular, tables are dense (13 to 14px) and sortable, and colour is spent only where it carries meaning.

The system is dense on purpose. Page titles are left-aligned and one line; a page's key numbers run inline as a row of labelled figures rather than boxed tiles; panels tile in a grid at 16 to 24px gaps. Light and dark themes share every variable name and follow the OS. The app bar stays navy in both. The system explicitly refuses the generic SaaS kit (centred hero, ghost-button rows, stat tiles, same-radius cards everywhere, arrow-suffixed links, a stock blue) and must not read as a broker or investing app.

Depth comes from rules and tints, not shadows. Motion is close to absent: a pulse on loading skeletons and colour or border changes on hover.

**Key Characteristics:**
- Navy app bar (mark, nav, search) over a cool grey-white ground, in both themes.
- White panels, 1px rules, 6px radius, no shadow; a ruled header strip holds title and controls.
- Source Sans 3 for everything; tabular figures on every number.
- Dense, sortable tables with a tinted header row and hairline row rules.
- Research blue for links, selection, focus and the primary action only; green and red only for signed numbers.

## Colors

A cool, near-neutral slate palette with one deep research blue and a strictly semantic green/red pair; every value has a light and a dark twin under the same variable name.

### Primary
- **Research Blue** (`brand`; dark `brand-dark`): links (underlined at 35% opacity, full on hover), the focus outline, the caret and form accent, the primary button, the "Direct" plan badge, the search suggestion highlight and text selection (via **Research Blue Wash**, `brand-soft`). It is also chart series 1, so a fund's own line is always the brand colour.

### Neutral
- **Cool Ground** (`bg`): the page background behind panels, and the sticky section-tab strip on the fund page.
- **Panel White** (`surface`): every panel, input, button, chip and the footer.
- **Ruled Tint** (`surface-2`): table header rows, row hover, button hover, skeletons, the formula and calculator wells.
- **Hairline** (`border`): panel borders, row rules, header-strip rules, divider lines between grouped content.
- **Strong Hairline** (`border-strong`): control borders (buttons, inputs, segmented controls, badges), the rule under table header rows, scrollbars.
- **Ink** (`text`): body text, fund names, figures; also the fill of a selected segmented option.
- **Slate Muted** (`muted`): secondary text, column headers, labels, subtitles, captions.
- **Slate Faint** (`faint`): null placeholders (the em dash) and decorative icons only; never running text.

### Shell
- **Navy Bar** (`shell`): the app bar background; the browser theme colour matches it (`#0f172a` light, `#090d13` dark).
- **Navy Raised** (`shell-2`): the search field inside the app bar.
- **Navy Rule** (`shell-border`): app bar bottom border, the mobile nav's top rule, the search field border.
- **Bar Text** (`shell-text`) and **Bar Muted** (`shell-muted`): mark and nav links at rest; links go white on hover.

### Semantic
- **Gain Green** (`pos`) and **Loss Red** (`neg`): the colour of a signed number's text, the calendar-return bars (70% fill), the monthly heatmap tints, and the "best in row" tint on compare (`pos` at 10%).
- **Caution Amber** (`warn`): inactive and legacy-plan badges, and the price-basis notice (amber text on a 10% amber wash with a 40% amber border).

### Chart Series
- **Series 1 to 5** (`series-1` blue, `series-2` orange, `series-3` teal, `series-4` violet, `series-5` rose): line colours for multi-series charts in order; charts read them from CSS at mount and on theme change.

### Named Rules
**The Signed-Number Rule.** Green and red appear only on signed values (returns, alpha, excess return, drawdowns), and the sign and value are always printed, so colour is never the only carrier. Zero and null take no colour.

**The Pointing Blue Rule.** Research Blue marks things you can follow or act on (links, focus, selection, the primary action) and nothing else. No blue panel fills, no blue headings, no blue decoration.

**The Navy Bar Rule.** The navy shell belongs to the app bar alone, and stays navy in both themes. Page content never uses shell colours.

## Typography

**Display Font:** Source Sans 3 (with ui-sans-serif, system-ui, sans-serif)
**Body Font:** Source Sans 3
**Label/Mono Font:** ui-monospace, SF Mono, Menlo, Consolas (formulas on /learn only)

**Character:** One humanist sans does everything, from the 28px page title down to 11px chart axes; hierarchy comes from size and weight steps that stay close together so numbers stay above the fold.

### Hierarchy
- **Display** (700, 28px, 26px below 640px, line-height 1.25): the one page title, left-aligned, with an optional 14px muted description under it (max 48rem).
- **Title** (600, 15px, 1.375): panel titles in the header strip; also the heading of each column in the home page's method strip.
- **Body** (400, 15px, 1.45): running text and descriptions.
- **Table** (400, 14px, tabular figures): table cells; fund names in tables are 600 Ink and turn blue and underlined on hover.
- **Control** (600, 13px): buttons, panel-head links, breadcrumbs and the sort status line (breadcrumbs and sort status at regular weight), the mobile nav row.
- **Label** (600, 12px, Slate Muted, sentence case): figure labels, table column headers, form labels, badges, segmented options, asset-class group headings.
- **Figure** (600, 17px, tabular): values in an inline figure row (a fund's key numbers, the home page facts row).
- **Figure Lead** (700, 26px, tabular): the latest NAV on a fund page, the one number set as large as the title.
- **Chart Axis** (400, 11px, Slate Muted): axis and crosshair labels inside charts, inheriting the body family.

### Named Rules
**The Tabular Figures Rule.** Every number on screen sets in tabular figures (the `.num` treatment), so columns and figure rows line up digit for digit. Numeric table columns are right-aligned; the fund column is left-aligned.

**The One Family Rule.** Source Sans 3 is the only face. Monospace appears only inside formula blocks.

## Layout

Fluid width with a 16px gutter on phones, 24px from 640px and 32px from 1024px, capped at 120rem only on very wide screens. The app bar is 56px tall and sticky; below 1024px its nav drops to a second, sideways-scrolling row. The main column has 24px of vertical padding.

Pages are grids of panels. Gaps are 16px between sibling panels in a tiled grid (home's category leaders: one, two, then three columns at 768px and 1280px) and 24px between major regions (fund page, screener). Common page frames: a left filter rail of 17rem beside the results (screener), a 15rem table of contents beside content (/learn), and a main column beside a 22rem rail (24rem from 1536px) on the fund page, where the main column itself splits into two from 1536px. The fund page's rail becomes sticky only when the viewport is at least 1024px wide and 860px tall, so it never pins a rail taller than the screen. The fund page's section tabs are a full-bleed sticky strip under the app bar.

Inside a panel, the body pads 16px; a table that opens or closes the panel runs flush to its edges and scrolls sideways when wider, with the fund column pinned. Figure rows space 32px between items and 12px between wrapped lines; on phones the fund page's figures become a four-column grid.

## Elevation & Depth

Flat by default. Panels, tables and controls carry no shadow; depth is conveyed by the Cool Ground behind white panels, 1px rules, and the Ruled Tint on header rows and hover. Only layers that float above the page cast a shadow: the search suggestions popover and the column-picker dialog. The pinned fund column in wide tables uses a 1px hairline drawn as a shadow, which is a rule, not elevation.

### Shadow Vocabulary
- **Popover** (`box-shadow: 0 8px 24px rgb(15 23 42 / 0.18)`): the search suggestions list under the app bar field.
- **Dialog** (`box-shadow: 0 16px 48px rgb(15 23 42 / 0.3)`): the column-picker modal, over a dimmed backdrop.
- **Pinned-column rule** (`box-shadow: 1px 0 0 var(--border)`): the right edge of a sticky first table column.

### Named Rules
**The Flat Panel Rule.** A panel never casts a shadow. If something needs to stand out on the page, it gets a rule, a tint or a position, not elevation; shadows are reserved for layers that float over content.

## Shapes

Two radii and nothing rounder. Panels, the popover and the dialog use a 6px corner; everything inside a panel (buttons, inputs, chips, badges, segmented controls, notices, wells, heatmap cells and bars) uses 4px. Borders are 1px throughout (2px only for the active tab underline and the app bar nav's hover underline). There are no pills, circles or fully rounded controls; the logo is the only circular form.

### Named Rules
**The Two Radii Rule.** 6px for containers that sit on the page, 4px for anything inside them. No third radius.

## Components

### Buttons
Compact and squared off, sized to sit inside a panel header strip.
- **Shape:** gently squared (4px), 32px tall, 12px horizontal padding, 6px gap to a 16px icon.
- **Default:** Panel White fill, Strong Hairline border, Ink text at Control weight; hover fills with Ruled Tint.
- **Primary:** Research Blue fill and border, On-Brand text; hover brightens slightly. One per view, for the action that submits (search, apply filters, calculate, retry).
- **Disabled:** 50% opacity. Pagination ends render the default button at 40% opacity as a non-link.
- **Focus:** the global 2px Research Blue outline, offset 2px.

### Chips
- **Style:** Panel White, Hairline border, 4px radius, 13px Ink text, 2px by 8px padding.
- **Use:** removable selections (funds in compare), a "Clear sort" action with a 12px close icon, metric direction hints, partial-year markers. Hover fills with Ruled Tint when the chip acts.

### Badges and Quartile Marks
- **Badge:** outlined only, never filled: 12px semibold text, 4px radius, 1px by 6px padding, border at 45% of the text colour. Tones are default (Slate Muted on Strong Hairline), brand, warn, pos and neg.
- **Quartile:** the same outline in Strong Hairline reading "Q1" to "Q4"; Q1 is bold Ink, the others semibold Slate Muted.

### Panels
- **Corner Style:** 6px.
- **Background:** Panel White on the Cool Ground.
- **Shadow Strategy:** none (see The Flat Panel Rule).
- **Border:** 1px Hairline.
- **Header strip:** 10px by 16px, Hairline rule beneath; the Title on the left (with an optional 12px Slate Muted subtitle), the panel's own controls or link on the right, wrapping beneath on narrow screens.
- **Internal Padding:** 16px.
- **Clickable panels** (the categories index) turn their border Research Blue on hover.

### Tables
The core of the product.
- **Header row:** Ruled Tint fill, Label type in Slate Muted, 8px by 12px, a Strong Hairline rule underneath. Sortable headers are links; the active one turns Ink and shows a 12px up or down arrow. A sort line above the table states the sort in words and offers "Clear sort".
- **Body:** Table type, 7px by 12px cells, Hairline rules between rows, Ruled Tint on row hover, no zebra striping. Numbers right-aligned in tabular figures, coloured only by The Signed-Number Rule.
- **Fund column:** pinned left when the table scrolls sideways, fund name in semibold Ink over a 12px Slate Muted line (fund house, category).

### Inputs / Fields
- **Style:** 32px tall, Panel White, Strong Hairline border, 4px radius, 14px text, Slate Muted placeholder.
- **Focus:** border turns Research Blue with a 2px Research Blue ring at 25%.
- **App bar variant:** Navy Raised fill, Navy Rule border, Bar Text, Bar Muted placeholder; focus lifts the border to Bar Muted with a faint white ring.

### Segmented Control
- **Style:** a single 4px-radius group with a Strong Hairline border; options are 12px semibold Slate Muted, 4px by 10px, separated by Hairline rules; hover fills Ruled Tint.
- **Selected:** inverted, Ink fill with Panel White text (not blue). Used for periods, rolling windows, plan filters and column presets; it scrolls sideways rather than wrapping on narrow screens.

### Navigation
- **App bar:** the logo mark (a lens over a rising line) and wordmark at 17px bold white, then nav links in 14px semibold Bar Muted that turn white with a 2px underline on hover, then the search field taking the remaining width up to 28rem. Below 1024px the links move to a sideways-scrolling 13px row under a Navy Rule.
- **Section tabs (fund page):** 14px semibold Slate Muted links 20px apart on the Cool Ground strip, with a 2px underline that appears in Strong Hairline on hover.
- **Breadcrumbs:** 13px Slate Muted with slash separators, Ink and underlined on hover.

### Figure Row (signature)
A page's key numbers run inline as label-over-value pairs (12px Label, then 17px Figure) with 32px between items, wrapping on narrow screens. No boxes, borders or backgrounds: the row is how this system replaces stat tiles.

### Percentile Bar (signature)
A 96px by 6px track in Ruled Tint with a Hairline inset ring and a 4px radius, filled in Ink at 70%, followed by "NN/100" in 12px Slate Muted tabular figures. Colour-neutral by design: a rank is not a gain or a loss.

### Charts
TradingView Lightweight Charts on a transparent ground, themed live from the same variables: Slate Muted 11px axis text, horizontal grid lines in Hairline, no vertical grid, no scale borders, magnet crosshair with Ink label backgrounds. Lines take Series 1 to 5 in order. The on-chart logo is off; attribution sits in the footer of every page.

## Do's and Don'ts

### Do:
- **Do** put every page's content in Panel White panels with a 1px Hairline border, a 6px radius and a ruled header strip that holds the title and that panel's own controls.
- **Do** set every number in tabular figures and right-align numeric columns.
- **Do** colour a number green or red only when it is signed, and always print its sign.
- **Do** keep Research Blue for links, focus, selection and the one primary action per view.
- **Do** show a page's headline numbers as an inline figure row (12px label over 17px value), not as tiles.
- **Do** read chart colours from the CSS variables so charts follow the theme.
- **Do** define every new colour as a variable with a light and a dark value under the same name.

### Don't:
- **Don't** put a shadow on a panel, card or table; shadows belong only to the popover and the dialog.
- **Don't** use a third radius, pills or fully rounded controls.
- **Don't** centre page titles or build a hero; the title is one left-aligned line with an optional description.
- **Don't** use stat tiles, ghost-button rows, arrow-suffixed links or a stock Tailwind blue.
- **Don't** fill badges or quartile marks; they are outlined.
- **Don't** use green or red for unsigned values, ranks or decoration.
- **Don't** set running text in Slate Faint; it is for null placeholders and decorative icons.
- **Don't** let anything look like a broker or investing app: no buy calls, ratings stars or promotional colour.

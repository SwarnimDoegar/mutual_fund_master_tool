# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Three audiences, served evenly: Indian DIY investors choosing their own direct-plan funds,
data-heavy enthusiasts who read rolling returns, risk ratios and drawdowns closely, and mutual
fund distributors and advisors researching funds for clients. The first screen of any page must
be approachable to the first group; full depth is one click away for the other two.

## Product Purpose

Fund Lens computes about 250 metrics for every Indian mutual fund scheme AMFI publishes
(returns, rolling returns, SIP XIRR, risk, drawdowns, benchmark-relative statistics, peer
ranks) from official NAVs, recomputed after each daily ingest, and lets people screen, compare
and study funds with them. Success: a visitor can shortlist and understand a fund faster and with
more confidence than on a broker's or a ratings site's page.

## Positioning

Every number is computed from published NAVs by one documented method, for all ~38,000 schemes
(about 8,700 active), and the methods are explained on /learn. It is research, not a place to
buy: no transactions, no ratings stars, no recommendations.

## Operating Context

Used on desktop for screening and comparing (wide tables, many columns), and on phones for
looking up one fund. Visitors arrive from search engines on a fund page, or start at the home
page, the screener or a category. Data refreshes daily; pages show the NAV date.

## Capabilities and Constraints

- Pages: home, screener (column presets, saved columns, filters, sort), categories and one
  category, fund houses and one fund house, fund list, fund page (returns, calendar, rolling,
  SIP, risk, benchmarks, drawdowns, ranks, calculators, data quality), compare, learn.
- Page structure and URLs stay as they are.
- Light and dark themes, following the OS setting.
- Green for gains and red for losses.
- Charts use TradingView Lightweight Charts (attribution required).
- Next.js 16 with Tailwind 4; pages are cached per data version, so the UI must stay server
  rendered and light on client JavaScript.
- Hosted on a single small homelab container behind Cloudflare: no paid services.
- Open decision: the name "Fund Lens" is in use but was not confirmed as binding.

## Brand Commitments

Must not look like a broker or investing app (Groww, Zerodha, Kuvera), nor like a generic SaaS
dashboard (rounded cards everywhere, stock blue, stat tiles). Must stay dense and quick to scan:
no oversized whitespace or type that pushes numbers below the fold.

Visual direction (chosen 2026-10-26): the category standard for fund research, executed at full
craft rather than reinvented. It should sit alongside Koyfin and Value Research Online; their
level of craft is the bar.

## Evidence on Hand

Real data for every page from mf-api. Data source: AMFI NAVs via mfapi.in. No testimonials,
user counts, press or partnerships exist; none may be invented.

## Product Principles

1. The numbers are the product: every layout decision serves reading and comparing them.
2. Show the method: a metric's definition and basis are always reachable.
3. Neutral, not promotional: no advice, ratings or calls to buy.
4. Fast everywhere: dense pages that load quickly on a phone.

## Accessibility & Inclusion

WCAG AA contrast in both themes; gains and losses never carried by colour alone (sign and
value always shown).

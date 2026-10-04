import Link from "next/link";
import { Card, Pct } from "@/components/ui";
import type { Scheme } from "@/lib/api/types";
import { date, int, nav, pct } from "@/lib/format";
import { categoryHref, fundHouseHref } from "@/lib/slug";

export function KeyFacts({ s }: { s: Scheme }) {
  const rows: [string, React.ReactNode][] = [
    ["Fund house", <Link key="h" className="link" href={fundHouseHref(s.fund_house)}>{s.fund_house}</Link>],
    ["Category", s.category ? <Link key="c" className="link" href={categoryHref(s.category)}>{s.category}</Link> : "—"],
    ["Benchmark", s.benchmark_index ?? "Category average only"],
    ["Plan · option", [s.plan, s.option].filter(Boolean).join(" · ") || "—"],
    ["Scheme type", s.scheme_type || "—"],
    ["First NAV", date(s.inception_date)],
    ["All-time high", `${nav(s.ath_nav)} (${pct(s.pct_below_ath)} below)`],
    ["52-week range", `${nav(s.low_52w)} – ${nav(s.high_52w)}`],
    ["vs 200-day average", <Pct key="sma" v={s.pct_vs_sma_200} />],
    ["AMFI code", String(s.scheme_code)],
    ["ISIN", s.isin_growth ?? s.isin_div_reinvestment ?? "—"],
    ["NAV records", int(s.nav_count)],
  ];
  return (
    <Card title="Key facts">
      <dl className="space-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4">
            <dt className="shrink-0 text-muted">{k}</dt>
            <dd className="min-w-0 text-right">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-muted">
        Category as reported to AMFI: {s.raw_category || "—"}. Expense ratio, AUM and holdings are not in AMFI&apos;s NAV feed.
      </p>
    </Card>
  );
}

/** Direct ↔ Regular plan and the Growth option of the same portfolio. */
export function PlanLinks({ s }: { s: Scheme }) {
  const links: [string, number][] = [];
  if (s.direct_plan_code) links.push(["Direct plan", s.direct_plan_code]);
  if (s.regular_plan_code) links.push(["Regular plan", s.regular_plan_code]);
  if (s.growth_option_code) links.push(["Growth option", s.growth_option_code]);
  if (!links.length) return null;
  const gap = [
    ["1Y", s.direct_minus_regular_1y],
    ["3Y", s.direct_minus_regular_3y],
    ["5Y", s.direct_minus_regular_5y],
  ] as const;
  return (
    <Card title="Same portfolio, other plans">
      <ul className="space-y-1.5 text-sm">
        {links.map(([label, code]) => (
          <li key={code}>
            <Link className="link" href={`/funds/${code}`}>
              {label} ({code})
            </Link>
          </li>
        ))}
      </ul>
      {gap.some(([, v]) => v != null) && (
        <div className="mt-3 border-t border-border pt-3 text-xs text-muted">
          <p className="mb-1">Direct minus Regular CAGR (roughly the distributor commission):</p>
          <div className="flex gap-4">
            {gap.map(([k, v]) => (
              <span key={k}>
                {k} <span className="num font-medium text-text">{pct(v)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

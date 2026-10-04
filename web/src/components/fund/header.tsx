import Link from "next/link";
import { GitCompareArrows } from "lucide-react";
import { Badge, Pct, Stat } from "@/components/ui";
import type { Scheme } from "@/lib/api/types";
import { date, nav, pct, years } from "@/lib/format";
import { categoryHref, fundHouseHref } from "@/lib/slug";

export function FundHeader({ s }: { s: Scheme }) {
  return (
    <header className="space-y-4">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
        <Link href="/categories" className="hover:text-text">
          Categories
        </Link>
        {s.category && (
          <>
            <span aria-hidden>/</span>
            <Link href={categoryHref(s.category)} className="hover:text-text">
              {s.category}
            </Link>
          </>
        )}
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-3xl">
          <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{s.scheme_name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <Link href={fundHouseHref(s.fund_house)} className="link font-medium">
              {s.fund_house}
            </Link>
            {s.asset_class && <Badge>{s.asset_class}</Badge>}
            {s.plan && <Badge tone="brand">{s.plan}</Badge>}
            {s.option && <Badge>{s.option}{s.idcw_frequency ? ` · ${s.idcw_frequency}` : ""}</Badge>}
            {!s.is_active && <Badge tone="warn">Inactive</Badge>}
            {s.is_legacy_plan ? <Badge tone="warn">Legacy plan</Badge> : null}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted">NAV · {date(s.last_nav_date)}</div>
          <div className="num text-3xl font-semibold tracking-tight">{nav(s.last_nav)}</div>
          <div className="text-sm">
            <Pct v={s.ret_1d} /> <span className="text-xs text-muted">1D</span>
          </div>
        </div>
      </div>

      {s.return_basis === "price" && (
        <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
          Returns of this {s.option} option exclude payouts. For total returns see the Growth option of the same scheme
          {s.growth_option_code ? (
            <>
              {" "}
              (<Link className="underline" href={`/funds/${s.growth_option_code}`}>open</Link>)
            </>
          ) : null}
          .
        </p>
      )}

      <div className="card grid grid-cols-2 gap-4 p-4 sm:grid-cols-4 lg:grid-cols-8">
        <Stat label="1Y return">
          <Pct v={s.ret_1y} />
        </Stat>
        <Stat label="3Y CAGR">
          <Pct v={s.cagr_3y} />
        </Stat>
        <Stat label="5Y CAGR">
          <Pct v={s.cagr_5y} />
        </Stat>
        <Stat label="Since inception" hint={`CAGR since ${date(s.inception_date)}`}>
          <Pct v={s.cagr_si} />
        </Stat>
        <Stat label="Volatility 3Y" hint="Annualised standard deviation of daily returns">
          {pct(s.volatility_3y)}
        </Stat>
        <Stat label="Sharpe 3Y" hint="Excess return per unit of volatility">
          {s.sharpe_3y?.toFixed(2) ?? "—"}
        </Stat>
        <Stat label="Max drawdown" hint={`Since inception: ${date(s.mdd_si_peak_date)} → ${date(s.mdd_si_trough_date)}`}>
          <span className="text-neg">{pct(s.max_drawdown_si)}</span>
        </Stat>
        <Stat label="Age">{years(s.age_years)}</Stat>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href={`/compare?codes=${s.scheme_code}`} className="btn">
          <GitCompareArrows className="size-4" aria-hidden /> Compare
        </Link>
      </div>
    </header>
  );
}

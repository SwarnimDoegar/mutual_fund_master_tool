import Link from "next/link";
import { GitCompareArrows } from "lucide-react";
import { Badge, Figures, Pct, Stat } from "@/components/ui";
import type { Scheme } from "@/lib/api/types";
import { date, nav, pct, years } from "@/lib/format";
import { categoryHref, fundHouseHref } from "@/lib/slug";

export function FundHeader({ s }: { s: Scheme }) {
  return (
    <header className="space-y-4">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
        <Link href="/categories" className="hover:text-text hover:underline underline-offset-[3px]">
          Categories
        </Link>
        {s.category && (
          <>
            <span aria-hidden>/</span>
            <Link href={categoryHref(s.category)} className="hover:text-text hover:underline underline-offset-[3px]">
              {s.category}
            </Link>
          </>
        )}
      </nav>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="h-page max-w-3xl text-balance">{s.scheme_name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <Link href={fundHouseHref(s.fund_house)} className="link font-semibold">
              {s.fund_house}
            </Link>
            {s.asset_class && <Badge>{s.asset_class}</Badge>}
            {s.plan && <Badge tone="brand">{s.plan}</Badge>}
            {s.option && <Badge>{s.option}{s.idcw_frequency ? ` · ${s.idcw_frequency}` : ""}</Badge>}
            {!s.is_active && <Badge tone="warn">Inactive</Badge>}
            {s.is_legacy_plan ? <Badge tone="warn">Legacy plan</Badge> : null}
          </div>
          <Figures className="mt-4 max-sm:grid max-sm:grid-cols-4 max-sm:gap-x-3">
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
          </Figures>
        </div>
        <div className="sm:text-right">
          <div className="label">NAV on {date(s.last_nav_date)}</div>
          <div className="num text-[26px] font-bold leading-tight">{nav(s.last_nav)}</div>
          <div className="text-sm">
            <Pct v={s.ret_1d} /> <span className="text-xs text-muted">1D</span>
          </div>
          <Link href={`/compare?codes=${s.scheme_code}`} className="btn mt-2">
            <GitCompareArrows className="size-4" aria-hidden /> Compare
          </Link>
        </div>
      </div>

      {s.return_basis === "price" && (
        <p className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-[13px] text-warn">
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


    </header>
  );
}

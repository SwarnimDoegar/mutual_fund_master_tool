import { cacheLife } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { AtVersion } from "@/components/at-version";
import { CardSkeleton, Figures, Pct, SkeletonBlock, Stat } from "@/components/ui";
import { VERSIONED, api } from "@/lib/api/server";
import type { MetaRow } from "@/lib/api/types";
import { categories, groupByAssetClass } from "@/lib/catalog";
import { date } from "@/lib/format";
import { categoryHref, fundHref, shortName } from "@/lib/slug";

const LEADER_CATEGORIES = [
  "Flexi Cap Fund",
  "Large Cap Fund",
  "Mid Cap Fund",
  "Small Cap Fund",
  "ELSS - Tax Saver Fund",
  "Aggressive Hybrid Fund",
];

export default function Home() {
  return (
    <div className="space-y-8">
      <section>
        <h1 className="h-page">Every Indian mutual fund, measured</h1>
        <p className="mt-1.5 max-w-3xl text-muted">
          Returns, risk, rolling returns, SIP XIRR and peer ranks for every scheme AMFI publishes, recomputed each night from official NAVs.
          Search for a fund above, or open the{" "}
          <Link className="link" href="/screener">
            screener
          </Link>
          ,{" "}
          <Link className="link" href="/compare">
            compare funds
          </Link>{" "}
          or read{" "}
          <Link className="link" href="/learn">
            how the metrics work
          </Link>
          .
        </p>
      </section>

      <Suspense fallback={<SkeletonBlock className="h-11 w-full max-w-3xl" />}>
        <AtVersion>{(v) => <Facts v={v} />}</AtVersion>
      </Suspense>

      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4">
          <h2 className="text-lg font-bold">Category leaders</h2>
          <span className="text-sm text-muted">Direct plans, ranked by 3-year CAGR</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {LEADER_CATEGORIES.map((c) => (
            <Suspense key={c} fallback={<CardSkeleton title={c} height="h-44" />}>
              <AtVersion>{(v) => <Leaders category={c} v={v} />}</AtVersion>
            </Suspense>
          ))}
        </div>
      </section>

      <Suspense fallback={<CardSkeleton height="h-64" />}>
        <AtVersion>{(v) => <BrowseCategories v={v} />}</AtVersion>
      </Suspense>

      <section className="card grid divide-border md:grid-cols-3 md:divide-x max-md:divide-y">
        {[
          ["Returns", "returns", "How returns are computed", "Trailing 1 day to 20 years, calendar and financial years, monthly heatmaps, rolling 1–10 year distributions and SIP XIRR for any dates."],
          ["Risk", "risk", "How risk is measured", "Volatility, downside deviation, drawdowns with recovery times, VaR/CVaR, Ulcer index, skew and kurtosis, on daily and Morningstar-comparable monthly bases."],
          ["Benchmarks", "benchmarks", "How benchmark statistics work", "Alpha, beta, R², tracking error, information ratio and up/down capture against both the category average and an index fund tracking the AMFI benchmark."],
        ].map(([t, anchor, more, d]) => (
          <div key={t} className="p-4">
            <h2 className="h-section">{t}</h2>
            <p className="mt-1 text-sm text-muted">{d}</p>
            <Link className="link mt-2 inline-block text-sm" href={`/learn#${anchor}`}>
              {more}
            </Link>
          </div>
        ))}
      </section>
    </div>
  );
}

async function Facts({ v }: { v: string }) {
  "use cache";
  cacheLife(VERSIONED);
  const res = await api<MetaRow>("/v1/meta", undefined, v);
  if (!res) return null;
  const m = res.data;
  const items: [string, string][] = [
    ["Schemes tracked", m.schemes.toLocaleString("en-IN")],
    ["Active schemes", m.active_schemes.toLocaleString("en-IN")],
    ["Peer-ranked funds", m.ranked_funds.toLocaleString("en-IN")],
    ["Categories", String(m.categories)],
    ["Fund houses", String(m.fund_houses)],
    ["NAVs as of", date(m.as_of_date)],
  ];
  return (
    <Figures>
      {items.map(([k, val]) => (
        <Stat key={k} label={k}>
          {val}
        </Stat>
      ))}
    </Figures>
  );
}

type LeaderRow = { scheme_code: number; scheme_name: string; fund_house: string; cagr_3y: number | null; ret_1y: number | null; sharpe_3y: number | null };

async function Leaders({ category, v }: { category: string; v: string }) {
  "use cache";
  cacheLife(VERSIONED);
  const res = await api<LeaderRow[]>(
    "/v1/screener",
    {
      category,
      plan: "Direct",
      peer_only: true,
      sort: "-cagr_3y",
      fields: "scheme_name,fund_house,cagr_3y,ret_1y,sharpe_3y",
      limit: 5,
    },
    v,
  );
  const rows = res?.data ?? [];
  return (
    <section className="card overflow-hidden">
      <div className="panel-head">
        <h3 className="h-section">
          <Link href={categoryHref(category)} className="hover:text-brand hover:underline underline-offset-[3px]">
            {category}
          </Link>
        </h3>
        <Link href={categoryHref(category)} className="link text-[13px]">
          All {res?.meta.total ?? ""} funds
        </Link>
      </div>
      <table className="table table-fixed">
        <thead>
          <tr>
            <th className="w-9 max-sm:hidden">#</th>
            <th>Scheme</th>
            <th className="r w-[5.5rem]">3Y CAGR</th>
            <th className="r w-[4.75rem]">1Y</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.scheme_code} className="[&:hover>td]:bg-surface-2">
              <td className="num text-muted max-sm:hidden">{i + 1}</td>
              <td className="max-sm:whitespace-normal sm:truncate">
                <Link href={fundHref(r.scheme_code, r.scheme_name)} className="row-link" title={r.scheme_name}>
                  {shortName(r.scheme_name)}
                </Link>
              </td>
              <td className="r">
                <Pct v={r.cagr_3y} className="font-semibold" />
              </td>
              <td className="r">
                <Pct v={r.ret_1y} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

async function BrowseCategories({ v }: { v: string }) {
  "use cache";
  cacheLife(VERSIONED);
  const groups = groupByAssetClass((await categories(v)).filter((c) => c.rankable));
  return (
    <section className="card">
      <div className="panel-head">
        <h2 className="h-section">Browse by category</h2>
        <Link href="/categories" className="link text-[13px]">
          All categories, including index funds, ETFs and FoFs
        </Link>
      </div>
      <div className="grid gap-x-8 gap-y-5 p-4 sm:grid-cols-2 xl:grid-cols-4">
        {groups.map(([cls, rows]) => (
          <div key={cls} className="min-w-0">
            <h3 className="label mb-1.5 border-b border-border pb-1.5">{cls}</h3>
            <ul className="space-y-1 text-sm">
              {rows.map((c) => (
                <li key={c.category} className="flex items-baseline justify-between gap-3">
                  <Link href={categoryHref(c.category)} className="truncate hover:text-brand hover:underline underline-offset-[3px]">
                    {c.category}
                  </Link>
                  <span className="num shrink-0 text-xs text-muted" title="Active schemes">
                    {c.active_schemes}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

import Link from "next/link";
import { Suspense } from "react";
import { SearchBox } from "@/components/search-box";
import { Card, CardSkeleton, Pct, SkeletonBlock } from "@/components/ui";
import { api } from "@/lib/api/server";
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
    <div className="space-y-10">
      <section className="mx-auto max-w-3xl pt-6 text-center sm:pt-10">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">Every Indian mutual fund, measured.</h1>
        <p className="mx-auto mt-3 max-w-2xl text-muted sm:text-lg">
          Returns, risk, rolling returns, SIP XIRR and peer ranks for every scheme AMFI publishes, recomputed each night from official NAVs.
        </p>
        <div className="mx-auto mt-6 max-w-xl text-left">
          <SearchBox placeholder="Try “parag flexi”, “nifty 50 index” or a scheme code" />
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-2 text-sm">
          <Link className="btn" href="/screener">
            Open the screener
          </Link>
          <Link className="btn" href="/compare">
            Compare funds
          </Link>
          <Link className="btn" href="/methodology">
            How we compute
          </Link>
        </div>
      </section>

      <Suspense fallback={<SkeletonBlock className="h-20 w-full" />}>
        <Stats />
      </Suspense>

      <section>
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-xl font-semibold tracking-tight">Category leaders</h2>
          <span className="text-xs text-muted">Direct plans, ranked by 3-year CAGR</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {LEADER_CATEGORIES.map((c) => (
            <Suspense key={c} fallback={<CardSkeleton title={c} height="h-48" />}>
              <Leaders category={c} />
            </Suspense>
          ))}
        </div>
      </section>

      <Suspense fallback={<CardSkeleton height="h-64" />}>
        <BrowseCategories />
      </Suspense>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          ["Returns", "Trailing 1 day to 20 years, calendar and financial years, monthly heatmaps, rolling 1–10 year distributions and SIP XIRR for any dates."],
          ["Risk", "Volatility, downside deviation, drawdowns with recovery times, VaR/CVaR, Ulcer index, skew and kurtosis — daily and Morningstar-comparable monthly bases."],
          ["Benchmarks", "Alpha, beta, R², tracking error, information ratio and up/down capture against both the category average and an index fund tracking the AMFI benchmark."],
        ].map(([t, d]) => (
          <Card key={t} title={t}>
            <p className="text-sm text-muted">{d}</p>
          </Card>
        ))}
      </section>
    </div>
  );
}

async function Stats() {
  const res = await api<MetaRow>("/v1/meta");
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
    <dl className="card grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 lg:grid-cols-6">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="num mt-0.5 text-lg font-semibold">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

type LeaderRow = { scheme_code: number; scheme_name: string; fund_house: string; cagr_3y: number | null; ret_1y: number | null; sharpe_3y: number | null };

async function Leaders({ category }: { category: string }) {
  const res = await api<LeaderRow[]>("/v1/screener", {
    category,
    plan: "Direct",
    peer_only: true,
    sort: "-cagr_3y",
    fields: "scheme_name,fund_house,cagr_3y,ret_1y,sharpe_3y",
    limit: 5,
  });
  const rows = res?.data ?? [];
  return (
    <Card
      title={
        <Link href={categoryHref(category)} className="hover:text-brand">
          {category}
        </Link>
      }
      action={
        <Link href={categoryHref(category)} className="link text-xs">
          All {res?.meta.total ?? ""} →
        </Link>
      }
    >
      <ol className="space-y-2.5 text-sm">
        {rows.map((r, i) => (
          <li key={r.scheme_code} className="grid grid-cols-[1.25rem_1fr_auto] items-baseline gap-2">
            <span className="num text-xs text-muted">{i + 1}</span>
            <Link href={fundHref(r.scheme_code, r.scheme_name)} className="truncate hover:text-brand" title={r.scheme_name}>
              {shortName(r.scheme_name)}
            </Link>
            <span className="text-right">
              <Pct v={r.cagr_3y} className="font-semibold" />
              <span className="ml-2 text-xs text-muted">1Y </span>
              <Pct v={r.ret_1y} className="text-xs" />
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

async function BrowseCategories() {
  const groups = groupByAssetClass((await categories()).filter((c) => c.rankable));
  return (
    <section>
      <h2 className="mb-3 text-xl font-semibold tracking-tight">Browse by category</h2>
      <div className="card space-y-4 p-4 sm:p-5">
        {groups.map(([cls, rows]) => (
          <div key={cls} className="flex flex-col gap-2 sm:flex-row">
            <h3 className="w-36 shrink-0 text-sm font-medium text-muted">{cls}</h3>
            <ul className="flex flex-wrap gap-2">
              {rows.map((c) => (
                <li key={c.category}>
                  <Link href={categoryHref(c.category)} className="chip hover:border-brand hover:text-text">
                    {c.category}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <Link href="/categories" className="link inline-block text-sm">
          All categories, including index funds, ETFs and FoFs →
        </Link>
      </div>
    </section>
  );
}

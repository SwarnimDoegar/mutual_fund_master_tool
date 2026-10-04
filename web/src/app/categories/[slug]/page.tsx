import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { GrowthChart, type GrowthData } from "@/components/charts/growth-chart";
import { FundTable, Pagination } from "@/components/fund-table";
import { Badge, Card, CardSkeleton, Empty, PageTitle, Value } from "@/components/ui";
import { api, apiOptional, seg } from "@/lib/api/server";
import { fundRows } from "@/lib/fund-rows";
import type { Benchmark, Category, CategoryIndexPoint, CategoryStat, NavPoint } from "@/lib/api/types";
import { alignTo } from "@/lib/series";
import { categoryBySlug } from "@/lib/catalog";
import { metric } from "@/lib/metrics";
import { ColumnPicker } from "@/components/column-picker";
import { resolveColumns } from "@/lib/columns-server";
import { PAGE_SIZE, fieldsFor } from "@/lib/screener";
import { categoryHref, fundHref } from "@/lib/slug";

export async function generateMetadata({ params }: PageProps<"/categories/[slug]">): Promise<Metadata> {
  const c = await categoryBySlug((await params).slug);
  return {
    title: `Best ${c.category}s`,
    description: `All ${c.active_schemes} active ${c.category} schemes ranked by returns, risk and consistency, with the category average and its distribution.`,
    alternates: { canonical: categoryHref(c.category) },
  };
}

export default function CategoryPage(props: PageProps<"/categories/[slug]">) {
  return (
    <Suspense fallback={<CardSkeleton height="h-[40rem]" />}>
      <CategoryView {...props} />
    </Suspense>
  );
}

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function CategoryView({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const c = await categoryBySlug((await params).slug);
  const sp = await searchParams;
  const plan = one(sp.plan) === "Regular" ? "Regular" : "Direct";
  const sort = one(sp.sort) ?? "-cagr_3y";
  const offset = Math.max(0, Number(one(sp.offset)) || 0);
  const cols = one(sp.cols);
  const columns = await resolveColumns(cols);
  const href = (p: { plan?: string; sort?: string; offset?: number }) => {
    const q = new URLSearchParams();
    if (cols) q.set("cols", cols);
    const pl = p.plan ?? plan;
    const so = p.sort ?? sort;
    if (pl !== "Direct") q.set("plan", pl);
    if (so !== "-cagr_3y") q.set("sort", so);
    if (p.offset) q.set("offset", String(p.offset));
    const qs = q.toString();
    return `${categoryHref(c.category)}${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <PageTitle
        title={c.category}
        subtitle={
          <>
            <Link href="/categories" className="hover:text-text">
              {c.asset_class}
            </Link>{" "}
            · {c.active_schemes.toLocaleString("en-IN")} active schemes
            {c.benchmark_index ? ` · Benchmark: ${c.benchmark_index}` : ""}
          </>
        }
      >
        <nav className="seg" aria-label="Plan">
          {["Direct", "Regular"].map((p) => (
            <Link key={p} href={href({ plan: p, offset: 0 })} aria-current={plan === p ? "page" : undefined}>
              {p}
            </Link>
          ))}
        </nav>
      </PageTitle>

      {!c.rankable && (
        <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted">
          Funds in this category are not peer-ranked (passive, fund-of-funds or too heterogeneous). Browse them in the{" "}
          <Link className="link" href={`/screener?category=${encodeURIComponent(c.category)}&all=1&plan=Any`}>
            screener
          </Link>
          .
        </p>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Suspense fallback={<CardSkeleton title="How the category has done" height="h-80" />}>
          <IndexCard c={c} plan={plan} />
        </Suspense>
        <Suspense fallback={<CardSkeleton title="Distribution" />}>
          <StatsCard c={c} plan={plan} />
        </Suspense>
      </div>

      <Suspense fallback={<CardSkeleton title="Funds" height="h-96" />}>
        <FundsCard c={c} plan={plan} sort={sort} offset={offset} href={href} columns={columns} />
      </Suspense>
    </div>
  );
}

async function IndexCard({ c, plan }: { c: Category; plan: string }) {
  const [idx, bench] = await Promise.all([
    apiOptional<CategoryIndexPoint[]>(`/v1/categories/${seg(c.category)}/index`, { plan, interval: "day" }),
    api<Benchmark[]>("/v1/benchmarks"),
  ]);
  const points = (idx?.data ?? []).map((p) => ({ date: p.date, value: p.level }));
  const proxy = bench?.data.find((b) => b.category === c.category);
  const proxyNav = proxy?.proxy_scheme_code
    ? await apiOptional<NavPoint[]>(`/v1/schemes/${proxy.proxy_scheme_code}/nav`, { interval: "day", from: points[0]?.date })
    : null;
  const indexName = proxy?.index_name.replace(/\s*\(via .*\)$/, "");

  const dates = points.map((p) => p.date);
  const data: GrowthData = { dates, lines: [{ name: `Average ${c.category}`, color: 1, values: alignTo(dates, points) }] };
  if (indexName && proxyNav?.data.length) {
    data.lines.push({
      name: indexName,
      color: 2,
      values: alignTo(dates, proxyNav.data.flatMap((p) => (p.nav != null ? [{ date: p.date, value: p.nav }] : []))),
    });
  }

  return (
    <Card
      title="How the category has done"
      subtitle={
        <>
          Growth of ₹10,000 in the average {c.category} ({plan} plans): an equal-weighted mix of every fund in the category on each
          day, including funds that were later merged or closed, so past losers are not quietly dropped.
          {indexName && proxy ? ` Benchmark line: ${proxy.proxy_scheme_name}, an index fund tracking ${indexName}.` : null}
        </>
      }
    >
      {dates.length < 2 ? <Empty>No category average for this category.</Empty> : <GrowthChart data={data} height={300} label={`${c.category} average`} />}
    </Card>
  );
}

const STAT_ORDER = ["ret_1y", "cagr_3y", "cagr_5y", "cagr_10y", "volatility_3y", "max_drawdown_3y", "sharpe_3y", "sortino_3y", "alpha_3y_category", "rolling_3y_median", "sip_xirr_5y"];

async function StatsCard({ c, plan }: { c: Category; plan: string }) {
  const res = await apiOptional<CategoryStat[]>(`/v1/categories/${seg(c.category)}/stats`, { plan });
  const by = new Map((res?.data ?? []).map((r) => [r.metric, r]));
  const rows = STAT_ORDER.flatMap((k) => (by.has(k) ? [by.get(k)!] : []));
  return (
    <Card
      title="How the funds spread"
      subtitle={`${plan} plans. Median: the middle fund. 25th / 75th: a quarter of funds are below / above that value. "Best fund" follows each metric's direction (e.g. lowest volatility).`}
    >
      {rows.length === 0 ? (
        <Empty>No ranked funds.</Empty>
      ) : (
        <div className="-mx-4 overflow-x-auto sm:-mx-5">
          <table className="table">
            <thead>
              <tr>
                <th>Metric</th>
                <th className="r">25th pct</th>
                <th className="r">Median</th>
                <th className="r">75th pct</th>
                <th>Best fund</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const d = metric(r.metric);
                return (
                  <tr key={r.metric}>
                    <td title={d.description}>{d.label}</td>
                    <td className="r"><Value v={r.p25} kind={d.kind} /></td>
                    <td className="r"><Value v={r.median} kind={d.kind} className="font-semibold" /></td>
                    <td className="r"><Value v={r.p75} kind={d.kind} /></td>
                    <td className="max-w-48 truncate">
                      {r.best_scheme_code ? (
                        <Link className="link text-xs" href={fundHref(r.best_scheme_code, r.best_scheme_name)} title={r.best_scheme_name ?? ""}>
                          {r.best_scheme_name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

async function FundsCard({
  c,
  plan,
  sort,
  offset,
  href,
  columns,
}: {
  c: Category;
  plan: string;
  sort: string;
  offset: number;
  href: (p: { plan?: string; sort?: string; offset?: number }) => string;
  columns: string[];
}) {
  const { rows, total, error } = await fundRows({
    category: c.category,
    plan,
    peer_only: Boolean(c.rankable),
    sort,
    fields: fieldsFor(columns, sort),
    limit: PAGE_SIZE,
    offset,
  });
  return (
    <Card
      title={
        <>
          Funds <Badge>{total.toLocaleString("en-IN")}</Badge>
        </>
      }
      subtitle="Click a column to sort."
      action={<ColumnPicker columns={columns} />}
      className="min-w-0"
    >
      {error ? (
        <Empty>{error}</Empty>
      ) : (
        <>
          <FundTable rows={rows} columns={columns} sort={sort} sortHref={(s) => href({ sort: s, offset: 0 })} showCategory={false} rankOffset={offset} />
          <Pagination total={total} limit={PAGE_SIZE} offset={offset} href={(o) => href({ offset: o })} />
        </>
      )}
    </Card>
  );
}

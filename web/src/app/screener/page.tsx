import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { Suspense } from "react";
import { ColumnPicker } from "@/components/column-picker";
import { FundTable, Pagination } from "@/components/fund-table";
import { ScreenerFilters } from "@/components/screener-filters";
import { Card, CardSkeleton, Empty, PageTitle } from "@/components/ui";
import { VERSIONED, currentVersion } from "@/lib/api/server";
import { categories, fundHouses } from "@/lib/catalog";
import { resolveColumns } from "@/lib/columns-server";
import { fundRows } from "@/lib/fund-rows";
import { PAGE_SIZE, parseScreener, screenerHref, screenerQuery, type ScreenerState } from "@/lib/screener";

export const metadata: Metadata = {
  title: "Mutual fund screener",
  description: "Filter and rank Indian mutual funds by returns, risk, Sharpe, rolling returns, SIP XIRR and benchmark statistics.",
};

export default function ScreenerPage({ searchParams }: PageProps<"/screener">) {
  return (
    <>
      <PageTitle title="Screener" subtitle="Peer-group funds: active Growth options of open-ended schemes. Click a column to sort; choose columns on the right." />
      <Suspense fallback={<CardSkeleton height="h-[32rem]" />}>
        <Screener searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Screener({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const [columns, v] = await Promise.all([resolveColumns(sp.cols), currentVersion()]);
  return <ScreenerBody state={parseScreener(sp)} columns={columns} v={v} />;
}

async function ScreenerBody({ state, columns, v }: { state: ScreenerState; columns: string[]; v: string }) {
  "use cache";
  cacheLife(VERSIONED);
  const [cats, houses, { rows, total, error }] = await Promise.all([categories(v), fundHouses(v), fundRows(screenerQuery(state, columns), v)]);

  return (
    <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside>
        <ScreenerFilters
          key={screenerHref({ ...state, cols: null, sort: "-cagr_3y", offset: 0 })}
          state={state}
          categories={cats.map((c) => ({ category: c.category, asset_class: c.asset_class }))}
          fundHouses={houses.map((h) => h.fund_house).sort((a, b) => a.localeCompare(b))}
        />
      </aside>
      <Card className="min-w-0" title={`${total.toLocaleString("en-IN")} funds`} action={<ColumnPicker columns={columns} />}>
        {error ? (
          <Empty>{error}</Empty>
        ) : (
          <>
            <FundTable
              rows={rows}
              columns={columns}
              sort={state.sort}
              sortHref={(sort) => screenerHref(state, { sort, offset: 0 })}
              rankOffset={state.offset}
            />
            <Pagination total={total} limit={PAGE_SIZE} offset={state.offset} href={(offset) => screenerHref(state, { offset })} />
          </>
        )}
      </Card>
    </div>
  );
}

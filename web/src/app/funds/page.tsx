import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { FundTable, Pagination, type FundTableRow } from "@/components/fund-table";
import { Card, CardSkeleton, Empty, PageTitle } from "@/components/ui";
import { ApiRequestError, VERSIONED, api, currentVersion } from "@/lib/api/server";
import type { SchemeListRow } from "@/lib/api/types";

export const metadata: Metadata = { title: "Find a fund", robots: { index: false, follow: true } };

const LIMIT = 50;
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function FundsPage({ searchParams }: PageProps<"/funds">) {
  return (
    <Suspense fallback={<CardSkeleton height="h-96" />}>
      <Results searchParams={searchParams} />
    </Suspense>
  );
}

async function Results({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  return (
    <ResultsBody
      q={one(sp.q)?.trim() ?? ""}
      fundHouse={one(sp.fund_house) ?? ""}
      category={one(sp.category) ?? ""}
      includeInactive={one(sp.inactive) === "1"}
      offset={Math.max(0, Number(one(sp.offset)) || 0)}
      v={await currentVersion()}
    />
  );
}

type BodyProps = { q: string; fundHouse: string; category: string; includeInactive: boolean; offset: number; v: string };

async function ResultsBody({ q, fundHouse, category, includeInactive, offset, v }: BodyProps) {
  "use cache";
  cacheLife(VERSIONED);
  const href = (p: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, fund_house: fundHouse, category, inactive: includeInactive ? "1" : "", ...p })) if (v) qs.set(k, String(v));
    return `/funds?${qs}`;
  };

  let rows: SchemeListRow[] = [];
  let total = 0;
  let error: string | null = null;
  if (q || fundHouse || category) {
    try {
      const res = await api<SchemeListRow[]>(
        "/v1/schemes",
        {
          q: q || undefined,
          fund_house: fundHouse || undefined,
          category: category || undefined,
          active: includeInactive ? undefined : true,
          limit: LIMIT,
          offset,
        },
        v,
      );
      rows = res?.data ?? [];
      total = res?.meta.total ?? rows.length;
    } catch (e) {
      if (!(e instanceof ApiRequestError)) throw e;
      error = e.message;
    }
  }
  const label = [q && `“${q}”`, fundHouse, category].filter(Boolean).join(" · ");

  return (
    <>
      <PageTitle title={label ? `Funds matching ${label}` : "Find a fund"} subtitle="Every word must appear in the scheme or fund-house name; a number matches the AMFI code.">
        <form action="/funds" className="flex w-full max-w-md gap-2">
          <input name="q" defaultValue={q} className="input" placeholder="e.g. parag flexi direct" aria-label="Search" />
          {fundHouse && <input type="hidden" name="fund_house" value={fundHouse} />}
          <button className="btn-primary">Search</button>
        </form>
      </PageTitle>
      <Card
        title={label ? `${total.toLocaleString("en-IN")} schemes` : undefined}
        action={
          label ? (
            <Link className="text-xs link" href={href({ inactive: includeInactive ? "" : "1", offset: undefined })}>
              {includeInactive ? "Hide inactive schemes" : "Include inactive schemes"}
            </Link>
          ) : undefined
        }
      >
        {error ? (
          <Empty>{error}</Empty>
        ) : !label ? (
          <Empty>
            Type a fund name above, or browse by <Link className="link" href="/categories">category</Link> or{" "}
            <Link className="link" href="/fund-houses">fund house</Link>.
          </Empty>
        ) : (
          <>
            <FundTable rows={rows as FundTableRow[]} columns={["last_nav", "ret_1y", "cagr_3y", "cagr_5y"]} />
            <Pagination total={total} limit={LIMIT} offset={offset} href={(o) => href({ offset: o })} />
          </>
        )}
      </Card>
    </>
  );
}

import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { FundTable, Pagination } from "@/components/fund-table";
import { Card, CardSkeleton, Empty, Figures, PageTitle, PercentileBar, Stat } from "@/components/ui";
import { VERSIONED, currentVersion } from "@/lib/api/server";
import type { FundHouse } from "@/lib/api/types";
import { fundHouseBySlug } from "@/lib/catalog";
import { fundRows } from "@/lib/fund-rows";
import { date, pct } from "@/lib/format";
import { ColumnPicker } from "@/components/column-picker";
import { resolveColumns } from "@/lib/columns-server";
import { PAGE_SIZE, fieldsFor } from "@/lib/screener";
import { fundHouseHref } from "@/lib/slug";

export async function generateMetadata({ params }: PageProps<"/fund-houses/[slug]">): Promise<Metadata> {
  const h = await fundHouseBySlug((await params).slug);
  return {
    title: h.fund_house,
    description: `${h.fund_house}: ${h.active_schemes} active schemes, how its ${h.ranked_funds} ranked funds compare within their categories.`,
    alternates: { canonical: fundHouseHref(h.fund_house) },
  };
}

export default function FundHousePage(props: PageProps<"/fund-houses/[slug]">) {
  return (
    <Suspense fallback={<CardSkeleton height="h-[40rem]" />}>
      <House {...props} />
    </Suspense>
  );
}

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function House({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const h = await fundHouseBySlug((await params).slug);
  const sp = await searchParams;
  const sort = one(sp.sort) ?? "-cagr_3y";
  const offset = Math.max(0, Number(one(sp.offset)) || 0);
  const plan = one(sp.plan) === "Regular" ? "Regular" : "Direct";
  const cols = one(sp.cols);
  const columns = await resolveColumns(cols);
  return <HouseBody h={h} plan={plan} sort={sort} offset={offset} cols={cols} columns={columns} v={await currentVersion()} />;
}

type BodyProps = { h: FundHouse; plan: string; sort: string; offset: number; cols?: string; columns: string[]; v: string };

async function HouseBody({ h, plan, sort, offset, cols, columns, v }: BodyProps) {
  "use cache";
  cacheLife(VERSIONED);
  const href = (p: { sort?: string; offset?: number; plan?: string }) => {
    const q = new URLSearchParams();
    if (cols) q.set("cols", cols);
    if ((p.plan ?? plan) !== "Direct") q.set("plan", p.plan ?? plan);
    if ((p.sort ?? sort) !== "-cagr_3y") q.set("sort", p.sort ?? sort);
    if (p.offset) q.set("offset", String(p.offset));
    const qs = q.toString();
    return `${fundHouseHref(h.fund_house)}${qs ? `?${qs}` : ""}`;
  };
  const { rows, total, error } = await fundRows(
    {
      fund_house: h.fund_house,
      plan,
      peer_only: true,
      sort,
      fields: fieldsFor(columns, sort),
      limit: PAGE_SIZE,
      offset,
    },
    v,
  );

  return (
    <div className="space-y-6">
      <PageTitle
        title={h.fund_house}
        subtitle={
          <>
            <Link href="/fund-houses" className="hover:text-text">
              All fund houses
            </Link>{" "}
            ·{" "}
            <Link href={`/funds?fund_house=${encodeURIComponent(h.fund_house)}`} className="link">
              Every scheme, including index funds and IDCW options
            </Link>
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
      <Figures className="card px-4 py-3">
        <Stat label="Active schemes">{h.active_schemes?.toLocaleString("en-IN")}</Stat>
        <Stat label="Ranked funds">{h.ranked_funds}</Stat>
        <Stat label="Categories">{h.categories}</Stat>
        <Stat label="Avg percentile, 3Y return (100 = best)">
          <PercentileBar value={h.avg_percentile_cagr_3y} />
        </Stat>
        <Stat label="Funds in top quarter">{pct(h.pct_top_quartile_cagr_3y)}</Stat>
        <Stat label="NAV history since">{date(h.first_nav_date)}</Stat>
      </Figures>
      <Card
        title="Ranked funds"
        subtitle="Active Growth options in peer-ranked categories. Click a column to sort."
        action={<ColumnPicker columns={columns} />}
        className="min-w-0"
      >
        {error ? (
          <Empty>{error}</Empty>
        ) : (
          <>
            <FundTable rows={rows} columns={columns} sort={sort} sortHref={(s) => href({ sort: s, offset: 0 })} rankOffset={offset} />
            <Pagination total={total} limit={PAGE_SIZE} offset={offset} href={(o) => href({ offset: o })} />
          </>
        )}
      </Card>
    </div>
  );
}

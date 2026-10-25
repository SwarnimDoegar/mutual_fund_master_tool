import type { Metadata } from "next";
import { X } from "lucide-react";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { ComparePicker } from "@/components/compare-picker";
import { MAX_COMPARE } from "@/lib/site";
import { TimeChart } from "@/components/charts/time-chart";
import { Card, CardSkeleton, Empty, PageTitle, Value } from "@/components/ui";
import { ApiRequestError, VERSIONED, api, currentVersion } from "@/lib/api/server";
import type { CompareGrowth, CompareRow } from "@/lib/api/types";
import { date } from "@/lib/format";
import { metric } from "@/lib/metrics";
import { packPoints } from "@/lib/packed";
import { fundHref } from "@/lib/slug";

export const metadata: Metadata = {
  title: "Compare mutual funds",
  description: "Compare up to six mutual funds side by side: growth, returns, risk, rolling returns and SIP XIRR.",
};

const ROWS: { title: string; keys: string[] }[] = [
  { title: "Returns", keys: ["ret_1m", "ret_6m", "ret_1y", "cagr_3y", "cagr_5y", "cagr_10y", "cagr_si"] },
  { title: "Risk", keys: ["volatility_3y", "max_drawdown_3y", "max_drawdown_si", "current_drawdown", "var_95_1y"] },
  { title: "Risk-adjusted", keys: ["sharpe_3y", "sortino_3y", "calmar_3y", "sharpe_3y_monthly"] },
  { title: "Against the category", keys: ["alpha_3y_category", "beta_3y_category", "information_ratio_3y_category", "up_capture_3y_category", "down_capture_3y_category"] },
  { title: "Consistency", keys: ["rolling_3y_median", "rolling_3y_min", "rolling_3y_pct_beat_category", "pct_positive_months"] },
  { title: "SIP", keys: ["sip_xirr_3y", "sip_xirr_5y", "sip_xirr_10y"] },
];

export default function ComparePage({ searchParams }: PageProps<"/compare">) {
  return (
    <>
      <PageTitle title="Compare funds" subtitle="Growth from a common start date and every headline metric side by side." />
      <Suspense fallback={<CardSkeleton height="h-96" />}>
        <Compare searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function parseCodes(v: string | string[] | undefined): number[] {
  const raw = (Array.isArray(v) ? v.join(",") : (v ?? "")).split(",");
  return [...new Set(raw.map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0))].slice(0, MAX_COMPARE);
}

async function Compare({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const codes = parseCodes((await searchParams).codes);
  return <CompareBody codes={codes} v={await currentVersion()} />;
}

async function CompareBody({ codes, v }: { codes: number[]; v: string }) {
  "use cache";
  cacheLife(VERSIONED);
  const without = (c: number) => {
    const rest = codes.filter((x) => x !== c);
    return rest.length ? `/compare?codes=${rest.join(",")}` : "/compare";
  };

  let rows: CompareRow[] = [];
  let growth: CompareGrowth[] = [];
  let error: string | null = null;
  if (codes.length >= 2) {
    try {
      const [a, b] = await Promise.all([
        api<CompareRow[]>("/v1/compare", { codes: codes.join(",") }, v),
        api<CompareGrowth[]>("/v1/compare/growth", { codes: codes.join(","), interval: "week" }, v),
      ]);
      rows = a?.data ?? [];
      growth = b?.data ?? [];
    } catch (e) {
      if (!(e instanceof ApiRequestError)) throw e;
      error = e.message;
    }
  } else if (codes.length === 1) {
    const one = await api<CompareRow>(`/v1/schemes/${codes[0]}`, undefined, v);
    rows = one ? [one.data] : [];
  }

  const series = growth.map((g, i) => ({
    name: g.scheme_name,
    color: i,
    points: packPoints(
      g.series.flatMap((p) => (p.date && p.value != null ? [{ date: p.date, value: p.value * 100 }] : [])),
      8,
    ),
  }));
  const start = growth[0]?.series[0]?.date;

  return (
    <div className="space-y-6">
      <Card title="Funds">
        <div className="space-y-3">
          {rows.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {rows.map((r) => (
                <li key={r.scheme_code} className="chip gap-2 py-1 text-sm text-text">
                  <Link href={fundHref(r.scheme_code, r.scheme_name)} className="hover:text-brand">
                    {r.scheme_name}
                  </Link>
                  <Link href={without(r.scheme_code)} aria-label={`Remove ${r.scheme_name}`} scroll={false} className="text-muted hover:text-neg">
                    <X className="size-3.5" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="max-w-md">
            <ComparePicker codes={codes} />
          </div>
          {codes.length < 2 && <p className="text-sm text-muted">Add at least two funds. Tip: compare a fund&apos;s Direct and Regular plans to see what commissions cost.</p>}
        </div>
      </Card>

      {error && <Empty>{error}</Empty>}

      {series.length >= 2 && (
        <Card title="Growth of ₹10,000" subtitle={
            start
              ? `₹10,000 put into each fund on ${date(start)}, the first date all of them have a NAV. Hover for the value on any date; the tags on the right axis are today's values. Weekly closes.`
              : undefined
          }>
          <TimeChart
            series={series}
            format="inr"
            height={360}
            showChange
            title={start ? `₹10,000 invested on ${date(start)} is worth today:` : undefined}
            hoverTitle={start ? `Value on {date} of ₹10,000 invested on ${date(start)}:` : undefined}
            ariaLabel="Growth of ₹10,000 in each compared fund"
          />
        </Card>
      )}

      {rows.length >= 2 && (
        <Card title="Side by side" subtitle="Best value in each row is highlighted (by the metric's direction).">
          <div className="-mx-4 overflow-x-auto sm:-mx-5">
            <table className="table">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 min-w-40 bg-surface">Metric</th>
                  {rows.map((r) => (
                    <th key={r.scheme_code} className="r min-w-36 max-w-48 whitespace-normal !text-text">
                      {r.scheme_name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="sticky left-0 z-10 bg-surface text-muted">Category</td>
                  {rows.map((r) => (
                    <td key={r.scheme_code} className="r whitespace-normal text-xs">
                      {r.category} · {r.plan}
                    </td>
                  ))}
                </tr>
                {ROWS.map((g) => (
                  <Group key={g.title} title={g.title} keys={g.keys} rows={rows} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Group({ title, keys, rows }: { title: string; keys: string[]; rows: CompareRow[] }) {
  return (
    <>
      <tr>
        <td colSpan={rows.length + 1} className="bg-surface-2 !py-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          <span className="sticky left-3">
          {title}
          </span>
        </td>
      </tr>
      {keys.map((k) => {
        const d = metric(k);
        const vals = rows.map((r) => (r as Record<string, unknown>)[k] as number | null | undefined);
        const finite = vals.filter((v): v is number => typeof v === "number");
        const best = d.better === "neither" || finite.length < 2 ? null : d.better === "higher" ? Math.max(...finite) : Math.min(...finite);
        return (
          <tr key={k}>
            <td title={d.description} className="sticky left-0 z-10 whitespace-normal bg-surface">
              {d.label}
            </td>
            {vals.map((v, i) => (
              <td key={rows[i].scheme_code} className={`r ${best != null && v === best ? "bg-pos/10 font-semibold" : ""}`}>
                <Value v={v} kind={d.kind} />
              </td>
            ))}
          </tr>
        );
      })}
    </>
  );
}

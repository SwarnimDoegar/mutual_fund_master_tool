"use client";

import { useMemo, useRef, useState } from "react";
import { fetchApi } from "@/lib/api/browser";
import type { RollingPoint } from "@/lib/api/types";
import { unpackRolling, type PackedRolling } from "@/lib/packed";
import { TimeChart, type ChartSeries } from "./time-chart";

function toSeries(points: RollingPoint[]): ChartSeries[] {
  const fund = points.filter((p) => p.fund_return != null).map((p) => ({ t: p.date, v: p.fund_return! }));
  const cat = points.filter((p) => p.category_return != null).map((p) => ({ t: p.date, v: p.category_return! }));
  const out: ChartSeries[] = [{ name: "This fund", points: fund, color: 0 }];
  if (cat.length) out.push({ name: "Category average", points: cat, color: 1 });
  return out;
}

/**
 * Rolling-return series for 1Y/3Y/5Y/10Y windows; other windows load on demand. The chart keeps
 * showing the current window until the requested one has loaded, so it never unmounts mid-switch.
 */
export function RollingChart({ code, periods, initial }: { code: number; periods: string[]; initial: PackedRolling }) {
  const [requested, setRequested] = useState(initial.period);
  const [shown, setShown] = useState(initial.period);
  const [cache, setCache] = useState<Record<string, RollingPoint[]>>(() => ({ [initial.period]: unpackRolling(initial) }));
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(initial.period);

  async function select(p: string) {
    latest.current = p;
    setRequested(p);
    setError(null);
    if (cache[p]) {
      setShown(p);
      return;
    }
    try {
      const res = await fetchApi<RollingPoint[]>(`/v1/schemes/${code}/rolling/${p}`, { interval: "week" });
      setCache((c) => ({ ...c, [p]: res.data }));
      if (latest.current === p) setShown(p);
    } catch (e) {
      if (latest.current !== p) return;
      setError(e instanceof Error ? e.message : "Could not load");
      setRequested(shown);
    }
  }

  const loading = requested !== shown && !error;
  const period = shown;
  const points = cache[shown];
  const series = useMemo(() => (points ? toSeries(points) : []), [points]);

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <div className="seg" role="group" aria-label="Rolling window">
          {periods.map((p) => (
            <button key={p} type="button" aria-pressed={requested === p} onClick={() => select(p)}>
              {p}
            </button>
          ))}
        </div>
        {loading && <span className="text-xs text-muted">Loading…</span>}
        {error && <span className="text-xs text-neg">{error}</span>}
      </div>
      <p className="mb-3 text-xs text-muted">{explain(period)}</p>
      {series.length > 0 && (
        <TimeChart
          series={series}
          format="pct"
          height={260}
          title={`${label(period)} for the ${words(period)} ending on the latest date:`}
          hoverTitle={`${label(period)} for the ${words(period)} ending {date}:`}
          ariaLabel={`Rolling ${period} returns of the fund and its category`}
        />
      )}
    </div>
  );
}

const years = (p: string) => Number(p.replace("Y", ""));
const words = (p: string) => `${years(p)} year${years(p) === 1 ? "" : "s"}`;
const label = (p: string) => (years(p) === 1 ? "1-year return" : `${years(p)}-year return, per year`);

function explain(p: string): string {
  const w = words(p);
  return `Each point is what an investor earned if they bought ${w} before that date and sold on it${
    years(p) > 1 ? " (as an annual rate)" : ""
  }. A line that stays above 0% means nobody who held for ${w} lost money; staying above the category line means the fund beat its category over most ${years(p)}-year stretches.`;
}

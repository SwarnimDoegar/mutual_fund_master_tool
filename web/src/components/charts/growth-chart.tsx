"use client";

import { useMemo, useState } from "react";
import { monthsBefore } from "@/lib/dates";
import { date } from "@/lib/format";
import { unpackDates, unpackValues, type PackedDates, type PackedValues } from "@/lib/packed";
import { TimeChart, type ChartSeries } from "./time-chart";

export type GrowthLine = {
  name: string;
  /** Price or index level on each of `dates` (empty before the line starts). */
  values: PackedValues;
  /** Palette index. */
  color: number;
};

/** Lines on a shared date axis. The first line is the anchor and must have a value on every date. */
export type GrowthData = { dates: PackedDates; lines: GrowthLine[] };

const RANGES = [
  { key: "1M", months: 1 },
  { key: "6M", months: 6 },
  { key: "1Y", months: 12 },
  { key: "3Y", months: 36 },
  { key: "5Y", months: 60 },
  { key: "10Y", months: 120 },
  { key: "Max", months: 0 },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

const BASE = 10_000;

/** Index of the last date on or before (latest date − months), like trailing returns. */
function startIndex(dates: string[], months: number): number {
  if (!months || dates.length === 0) return 0;
  const start = monthsBefore(dates.at(-1)!, months);
  let lo = 0;
  let hi = dates.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= start) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

const yearsBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (365.25 * 86_400_000);

/**
 * "Growth of ₹10,000": every visible line is rescaled so ₹10,000 goes in on the same first day.
 * If a comparison line has no data at the start of the chosen period, the chart starts on the
 * first day every visible line has a value (and says so), so all lines cover the same dates.
 */
export function GrowthChart({ data: packed, height = 320, label }: { data: GrowthData; height?: number; label: string }) {
  const data = useMemo(
    () => ({ dates: unpackDates(packed.dates), lines: packed.lines.map((l) => ({ ...l, values: unpackValues(l.values) })) }),
    [packed],
  );
  const spanYears = data.dates.length ? yearsBetween(data.dates[0], data.dates.at(-1)!) : 0;
  const available = RANGES.filter((r) => r.months === 0 || r.months / 12 <= spanYears + 0.05);
  const [range, setRange] = useState<RangeKey>(available.some((r) => r.key === "5Y") ? "5Y" : "Max");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [anchor, ...others] = data.lines;

  const { series, start, shiftedBy } = useMemo(() => {
    const visible = [anchor, ...others.filter((o) => !hidden.has(o.name))];
    const wanted = startIndex(data.dates, RANGES.find((r) => r.key === range)!.months);
    // first index ≥ wanted where every visible line has a value
    let i0 = wanted;
    let shiftedBy: string | null = null;
    for (const l of visible) {
      const first = l.values.findIndex((v, i) => i >= wanted && v != null);
      if (first > i0) {
        i0 = first;
        shiftedBy = l.name;
      }
    }
    const dates = data.dates.slice(i0);
    const out: ChartSeries[] = visible.map((l) => {
      const vals = l.values.slice(i0);
      const base = vals[0]!;
      return {
        name: l.name,
        color: l.color,
        points: dates.flatMap((t, j) => (vals[j] == null ? [] : [{ t, v: (vals[j]! / base) * BASE }])),
      };
    });
    return { series: out, start: dates[0], shiftedBy };
  }, [data, anchor, others, range, hidden]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="seg" role="group" aria-label="Period">
          {available.map((r) => (
            <button key={r.key} type="button" aria-pressed={range === r.key} onClick={() => setRange(r.key)}>
              {r.key}
            </button>
          ))}
        </div>
        {others.length > 0 && (
          <div className="flex flex-wrap gap-3 text-xs text-muted">
            {others.map((o) => (
              <label key={o.name} className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  className="accent-[var(--brand)]"
                  checked={!hidden.has(o.name)}
                  onChange={(e) =>
                    setHidden((h) => {
                      const n = new Set(h);
                      if (e.target.checked) n.delete(o.name);
                      else n.add(o.name);
                      return n;
                    })
                  }
                />
                Show {o.name}
              </label>
            ))}
          </div>
        )}
      </div>
      <TimeChart
        series={series}
        format="inr"
        height={height}
        showChange
        title={start ? `₹10,000 invested on ${date(start)} is worth today:` : undefined}
        hoverTitle={start ? `Value on {date} of ₹10,000 invested on ${date(start)}:` : undefined}
        ariaLabel={`${label}: growth of ₹10,000 over ${range}`}
      />
      {shiftedBy && start && (
        <p className="mt-2 text-xs text-muted">
          Starts on {date(start)}, the first day with data for {shiftedBy}. Untick it to see {anchor.name.toLowerCase()} over the full
          period.
        </p>
      )}
    </div>
  );
}

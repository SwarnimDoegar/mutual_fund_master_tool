import type { GrowthData } from "@/components/charts/growth-chart";
import { packDates, packValues } from "./packed";

type Points = { date: string; value: number }[];

/** Value of `points` on each of `dates`, carrying the last known value forward (null before the first). */
export function alignTo(dates: string[], points: Points): (number | null)[] {
  const out: (number | null)[] = new Array(dates.length).fill(null);
  let j = 0;
  let last: number | null = null;
  for (let i = 0; i < dates.length; i++) {
    while (j < points.length && points[j].date <= dates[i]) last = points[j++].value;
    out[i] = last;
  }
  return out;
}

/**
 * A GrowthChart's data: every line aligned to the dates of the first, packed for the client.
 * 8 significant digits keep restated NAVs (more than four decimals after a unit change) intact.
 */
export function growthData(lines: { name: string; color: number; points: Points }[]): GrowthData {
  const dates = lines[0]?.points.map((p) => p.date) ?? [];
  return {
    dates: packDates(dates),
    lines: lines.map((l) => ({ name: l.name, color: l.color, values: packValues(alignTo(dates, l.points), 8) })),
  };
}

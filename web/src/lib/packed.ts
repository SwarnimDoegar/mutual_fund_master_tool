// Chart series cross from server components to the client charts as compact strings rather than
// arrays: a fund's daily history is ~3,300 points per line, and as JSON (full ISO dates, 17-digit
// floats, repeated object keys) the charts were over half of a fund page's payload. Strings also
// embed in the HTML without per-element escaping.
import type { RollingPoint } from "./api/types";

/** Dates as the first date and the day gaps after it: "2013-05-28+1,1,3,1". */
export type PackedDates = string;
/** Numbers rounded to a few significant digits, comma-separated; an empty slot is null. */
export type PackedValues = string;
/** A date-ordered series of (date, value) points. */
export type PackedPoints = { dates: PackedDates; values: PackedValues };

const DAY = 86_400_000;
const dayNumber = (d: string) => Date.parse(`${d}T00:00:00Z`) / DAY;
const isoDay = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);

export function packDates(dates: string[]): PackedDates {
  if (!dates.length) return "";
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) gaps.push(dayNumber(dates[i]) - dayNumber(dates[i - 1]));
  return gaps.length ? `${dates[0]}+${gaps.join(",")}` : dates[0];
}

export function unpackDates(packed: PackedDates): string[] {
  if (!packed) return [];
  const [first, gaps] = packed.split("+");
  const out = [first];
  if (!gaps) return out;
  let n = dayNumber(first);
  for (const g of gaps.split(",")) out.push(isoDay((n += Number(g))));
  return out;
}

/**
 * `digits` significant digits: 8 keeps NAVs and index levels exact to well under a paisa per
 * ₹10,000; 5 keeps returns to a thousandth of a percentage point.
 */
export function packValues(values: (number | null | undefined)[], digits: number): PackedValues {
  return values.map((v) => (v == null || !Number.isFinite(v) ? "" : String(Number(v.toPrecision(digits))))).join(",");
}

export function unpackValues(packed: PackedValues): (number | null)[] {
  if (!packed) return [];
  return packed.split(",").map((s) => (s === "" ? null : Number(s)));
}

export function packPoints(points: { date: string; value: number | null | undefined }[], digits: number): PackedPoints {
  const kept = points.filter((p) => p.value != null && Number.isFinite(p.value));
  return { dates: packDates(kept.map((p) => p.date)), values: packValues(kept.map((p) => p.value), digits) };
}

export function unpackPoints(packed: PackedPoints): { t: string; v: number }[] {
  const dates = unpackDates(packed.dates);
  const values = unpackValues(packed.values);
  return dates.map((t, i) => ({ t, v: values[i] ?? 0 }));
}

/** A fund's rolling-return series with its category's, on one date axis. */
export type PackedRolling = { period: string; dates: PackedDates; fund: PackedValues; category: PackedValues };

export function packRolling(period: string, points: RollingPoint[]): PackedRolling {
  return {
    period,
    dates: packDates(points.map((p) => p.date)),
    fund: packValues(points.map((p) => p.fund_return), 5),
    category: packValues(points.map((p) => p.category_return), 5),
  };
}

export function unpackRolling(packed: PackedRolling): RollingPoint[] {
  const fund = unpackValues(packed.fund);
  const category = unpackValues(packed.category);
  return unpackDates(packed.dates).map((date, i) => ({ date, fund_return: fund[i] ?? 0, category_return: category[i] }));
}

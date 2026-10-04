// Row types generated from mf-api's OpenAPI document (`pnpm gen:api`).
import type { components } from "./schema";

type S = components["schemas"];

export type Meta = S["Meta"];
export type MetaRow = S["MetaRow"];
export type SchemeListRow = S["SchemesRow"];
export type Scheme = S["SchemeRow"];
export type NavPoint = S["NavRow"];
export type TrailingReturn = S["ReturnsRow"];
export type CalendarReturn = S["CalendarReturnsRow"];
export type RiskRow = S["RiskRow"];
export type RelativeRow = S["RelativeRow"];
export type RollingRow = S["RollingRow"];
export type RollingPoint = S["RollingSeriesRow"];
export type SipRow = S["SipRow"];
export type Drawdown = S["DrawdownsRow"];
export type DrawdownPoint = S["DrawdownSeriesRow"];
export type RankRow = S["RanksRow"];
export type Payout = S["PayoutsRow"];
export type Quality = S["QualityRow"];
export type SipResult = S["CalculateSipRow"];
export type LumpsumResult = S["CalculateLumpsumRow"];
export type ScreenRow = S["ScreenRow"];
export type Category = S["CategoriesRow"];
export type CategoryStat = S["CategoryStatsRow"];
export type CategoryIndexPoint = S["CategoryIndexRow"];
export type FundHouse = S["FundHousesRow"];
export type Benchmark = S["BenchmarksRow"];
export type CompareRow = S["CompareRow"];
export type CompareGrowth = S["CompareGrowthRow"];

/** Every mf-api success response: `{ data, meta }`. */
export type Envelope<T> = { data: T; meta: Meta };

export type Interval = "day" | "week" | "month";
export type Query = Record<string, string | number | boolean | null | undefined>;

/** Query string with sorted keys and empty values dropped (stable cache keys). */
export function toQuery(query?: Query): string {
  if (!query) return "";
  const pairs = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return pairs.length ? `?${pairs.join("&")}` : "";
}

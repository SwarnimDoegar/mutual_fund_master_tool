// Screener URL state ⇄ mf-api /v1/screener query.
//
// The page URL uses display units (percent for return/percentage metrics), e.g.
// `?category=Mid+Cap+Fund&min_cagr_3y=15&sort=-sharpe_3y&cols=ret_1y,cagr_3y`; the API takes
// fractions.
import { parseColumns } from "./columns";
import { metric } from "./metrics";
import type { Query } from "./api/types";

/** Columns every fund table needs besides the metrics. */
export const IDENTITY = ["scheme_name", "fund_house", "category", "plan", "option"];
export const PAGE_SIZE = 50;
const FILTER_KEYS = ["category", "asset_class", "fund_house", "plan"] as const;

export type ScreenerState = {
  /** `cols` as given in the URL (null: the saved or default columns apply). */
  cols: string[] | null;
  sort: string;
  offset: number;
  all: boolean;
  filters: Partial<Record<(typeof FILTER_KEYS)[number], string>>;
  /** metric → [min, max] in display units */
  ranges: Record<string, [number | null, number | null]>;
};

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const numOrNull = (v: string | undefined) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
export const isPercent = (key: string) => ["pct", "ret"].includes(metric(key).kind);

export function parseScreener(sp: Params): ScreenerState {
  const ranges: ScreenerState["ranges"] = {};
  for (const [k, v] of Object.entries(sp)) {
    const m = /^(min|max)_(.+)$/.exec(k);
    if (!m) continue;
    const r = (ranges[m[2]] ??= [null, null]);
    r[m[1] === "min" ? 0 : 1] = numOrNull(one(v));
  }
  const filters: ScreenerState["filters"] = {};
  for (const k of FILTER_KEYS) {
    const v = one(sp[k]);
    if (v) filters[k] = v;
  }
  if (!filters.plan) filters.plan = "Direct";
  if (filters.plan === "Any") delete filters.plan;
  return {
    cols: parseColumns(one(sp.cols)),
    sort: one(sp.sort) ?? "-cagr_3y",
    offset: Math.max(0, Number(one(sp.offset)) || 0),
    all: one(sp.all) === "1",
    filters,
    ranges,
  };
}

export function screenerHref(s: ScreenerState, patch: Partial<ScreenerState> = {}): string {
  const n = { ...s, ...patch };
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(n.filters)) if (v && !(k === "plan" && v === "Direct")) q.set(k, v);
  if (!n.filters.plan) q.set("plan", "Any");
  for (const [k, [lo, hi]] of Object.entries(n.ranges)) {
    if (lo != null) q.set(`min_${k}`, String(lo));
    if (hi != null) q.set(`max_${k}`, String(hi));
  }
  if (n.cols) q.set("cols", n.cols.join(","));
  if (n.sort !== "-cagr_3y") q.set("sort", n.sort);
  if (n.all) q.set("all", "1");
  if (n.offset) q.set("offset", String(n.offset));
  const qs = q.toString();
  return qs ? `/screener?${qs}` : "/screener";
}

/** `fields` for /v1/screener: identity columns, the shown metrics and the sort column. */
export function fieldsFor(columns: string[], sort: string): string {
  const sortKey = sort.replace(/^-/, "");
  return [...IDENTITY, ...columns, ...(columns.includes(sortKey) ? [] : [sortKey])].join(",");
}

export function screenerQuery(s: ScreenerState, columns: string[]): Query {
  const q: Query = {
    ...s.filters,
    peer_only: !s.all,
    sort: s.sort,
    fields: fieldsFor(columns, s.sort),
    limit: PAGE_SIZE,
    offset: s.offset,
  };
  for (const [k, [lo, hi]] of Object.entries(s.ranges)) {
    const scale = isPercent(k) ? 0.01 : 1;
    if (lo != null) q[`min_${k}`] = lo * scale;
    if (hi != null) q[`max_${k}`] = hi * scale;
  }
  return q;
}

// Fund-table columns: presets, and the user's own choice.
//
// The choice lives in the URL (`?cols=ret_1y,cagr_3y,…`, so a view can be shared) and in a
// cookie (so it sticks across pages and visits). Resolution: URL, then cookie, then the default.
import { METRIC } from "./metrics";

export const COLUMNS_COOKIE = "fl_cols";
export const MAX_COLUMNS = 40;

export const PRESETS = {
  overview: { label: "Overview", columns: ["ret_1y", "cagr_3y", "cagr_5y", "volatility_3y", "sharpe_3y", "max_drawdown_3y", "rolling_3y_median", "sip_xirr_5y"] },
  returns: { label: "Returns", columns: ["ret_1m", "ret_3m", "ret_6m", "ret_ytd", "ret_1y", "cagr_3y", "cagr_5y", "cagr_10y", "cagr_si"] },
  risk: { label: "Risk", columns: ["volatility_3y", "volatility_3y_monthly", "max_drawdown_3y", "max_drawdown_si", "current_drawdown", "ulcer_index_3y", "var_95_1y", "cvar_95_1y"] },
  ratios: { label: "Risk-adjusted", columns: ["sharpe_3y", "sharpe_3y_monthly", "sortino_3y", "calmar_3y", "information_ratio_3y_category", "up_capture_3y_category", "down_capture_3y_category"] },
  benchmark: { label: "Benchmark", columns: ["alpha_3y_index", "beta_3y_index", "excess_cagr_3y_index", "information_ratio_3y_index", "alpha_3y_category", "beta_3y_category", "r_squared_3y_category", "batting_average_3y_category"] },
  rolling: { label: "Rolling", columns: ["rolling_1y_median", "rolling_1y_pct_negative", "rolling_3y_median", "rolling_3y_min", "rolling_3y_pct_above_10", "rolling_3y_pct_beat_category", "rolling_5y_median", "rolling_5y_min"] },
  sip: { label: "SIP", columns: ["sip_xirr_1y", "sip_xirr_3y", "sip_xirr_5y", "sip_xirr_10y", "cagr_3y", "cagr_5y"] },
} as const satisfies Record<string, { label: string; columns: readonly string[] }>;
export type PresetKey = keyof typeof PRESETS;

export const DEFAULT_COLUMNS: string[] = [...PRESETS.overview.columns];

/** Known metric keys from a comma-separated list, in order, without duplicates; null if none. */
export function parseColumns(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  const out: string[] = [];
  for (const k of raw.split(",")) {
    const key = k.trim();
    if (METRIC.has(key) && !out.includes(key)) out.push(key);
    if (out.length >= MAX_COLUMNS) break;
  }
  return out.length ? out : null;
}

export function presetOf(columns: string[]): PresetKey | null {
  for (const [k, p] of Object.entries(PRESETS)) {
    if (p.columns.length === columns.length && p.columns.every((c, i) => c === columns[i])) return k as PresetKey;
  }
  return null;
}

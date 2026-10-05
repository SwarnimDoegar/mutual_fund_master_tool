// Labels and meaning of the `fund_metrics` columns the UI shows (screener, ranks, category
// statistics, the column picker). Longer explanations live in learn.ts.
import type { ValueKind } from "./format";

export type MetricGroup = "Returns" | "Risk" | "Risk-adjusted" | "Benchmark" | "Rolling" | "SIP" | "Price" | "Data";

export type MetricDef = {
  key: string;
  label: string;
  short: string;
  kind: ValueKind;
  /** Which direction is better, for colouring and ranking hints. */
  better: "higher" | "lower" | "neither";
  group: MetricGroup;
  description: string;
};

const m = (
  key: string,
  label: string,
  short: string,
  kind: ValueKind,
  better: MetricDef["better"],
  group: MetricGroup,
  description: string,
): MetricDef => ({ key, label, short, kind, better, group, description });

const RET = "Absolute return from the NAV on or before the start date.";
const CAGR = "Compound annual growth rate from the NAV on or before the start date; blank if the fund is younger.";

export const METRICS: MetricDef[] = [
  m("ret_1d", "1-day return", "1D", "ret", "higher", "Returns", RET),
  m("ret_1w", "1-week return", "1W", "ret", "higher", "Returns", RET),
  m("ret_1m", "1-month return", "1M", "ret", "higher", "Returns", RET),
  m("ret_3m", "3-month return", "3M", "ret", "higher", "Returns", RET),
  m("ret_6m", "6-month return", "6M", "ret", "higher", "Returns", RET),
  m("ret_ytd", "Year-to-date return", "YTD", "ret", "higher", "Returns", "Return since the last NAV of the previous calendar year."),
  m("ret_fytd", "Financial-year-to-date return", "FYTD", "ret", "higher", "Returns", "Return since 31 March."),
  m("ret_1y", "1-year return", "1Y", "ret", "higher", "Returns", RET),
  m("cagr_2y", "2-year CAGR", "2Y", "ret", "higher", "Returns", CAGR),
  m("cagr_3y", "3-year CAGR", "3Y", "ret", "higher", "Returns", CAGR),
  m("cagr_5y", "5-year CAGR", "5Y", "ret", "higher", "Returns", CAGR),
  m("cagr_7y", "7-year CAGR", "7Y", "ret", "higher", "Returns", CAGR),
  m("cagr_10y", "10-year CAGR", "10Y", "ret", "higher", "Returns", CAGR),
  m("cagr_15y", "15-year CAGR", "15Y", "ret", "higher", "Returns", CAGR),
  m("cagr_si", "CAGR since inception", "SI", "ret", "higher", "Returns", "Annualised return since the first NAV on record."),
  m("best_calendar_year", "Best calendar year", "Best yr", "ret", "higher", "Returns", "Highest full calendar-year return."),
  m("worst_calendar_year", "Worst calendar year", "Worst yr", "ret", "higher", "Returns", "Lowest full calendar-year return."),
  m("pct_positive_months", "Positive months", "% +ve mo", "pct", "higher", "Returns", "Share of complete months with a positive return."),

  m("volatility_1y", "Volatility (1Y)", "Vol 1Y", "pct", "lower", "Risk", "Annualised standard deviation of daily returns."),
  m("volatility_3y", "Volatility (3Y)", "Vol 3Y", "pct", "lower", "Risk", "Annualised standard deviation of daily returns."),
  m("volatility_5y", "Volatility (5Y)", "Vol 5Y", "pct", "lower", "Risk", "Annualised standard deviation of daily returns."),
  m("volatility_3y_monthly", "Volatility (3Y, monthly)", "Vol 3Y (m)", "pct", "lower", "Risk", "Standard deviation of monthly returns ×√12 — comparable with Morningstar and Value Research."),
  m("max_drawdown_1y", "Max drawdown (1Y)", "MDD 1Y", "pct", "higher", "Risk", "Deepest fall from a running high within the window."),
  m("max_drawdown_3y", "Max drawdown (3Y)", "MDD 3Y", "pct", "higher", "Risk", "Deepest fall from a running high within the window."),
  m("max_drawdown_5y", "Max drawdown (5Y)", "MDD 5Y", "pct", "higher", "Risk", "Deepest fall from a running high within the window."),
  m("max_drawdown_si", "Max drawdown (since inception)", "MDD SI", "pct", "higher", "Risk", "Deepest fall from a running high since the first NAV."),
  m("current_drawdown", "Current drawdown", "Below ATH", "pct", "higher", "Risk", "How far the latest NAV is below its all-time high."),
  m("ulcer_index_3y", "Ulcer index (3Y)", "Ulcer 3Y", "pct", "lower", "Risk", "Root-mean-square drawdown: depth and duration of declines."),
  m("var_95_1y", "Value at risk 95% (1Y)", "VaR 95", "pct", "lower", "Risk", "One-day loss exceeded on 5% of days over the past year."),
  m("cvar_95_1y", "Conditional VaR 95% (1Y)", "CVaR 95", "pct", "lower", "Risk", "Average one-day loss on the worst 5% of days."),
  m("skewness_3y", "Skewness (3Y)", "Skew", "ratio", "higher", "Risk", "Asymmetry of daily returns; negative means fatter left tail."),
  m("excess_kurtosis_3y", "Excess kurtosis (3Y)", "Kurt", "ratio", "lower", "Risk", "Tail heaviness of daily returns relative to a normal distribution."),

  m("sharpe_1y", "Sharpe ratio (1Y)", "Sharpe 1Y", "ratio", "higher", "Risk-adjusted", "Annualised mean excess return over the risk-free rate ÷ its volatility."),
  m("sharpe_3y", "Sharpe ratio (3Y)", "Sharpe 3Y", "ratio", "higher", "Risk-adjusted", "Annualised mean excess return over the risk-free rate ÷ its volatility."),
  m("sharpe_5y", "Sharpe ratio (5Y)", "Sharpe 5Y", "ratio", "higher", "Risk-adjusted", "Annualised mean excess return over the risk-free rate ÷ its volatility."),
  m("sharpe_3y_monthly", "Sharpe ratio (3Y, monthly)", "Sharpe 3Y (m)", "ratio", "higher", "Risk-adjusted", "Sharpe on monthly returns — comparable with Morningstar and Value Research."),
  m("sortino_3y", "Sortino ratio (3Y)", "Sortino 3Y", "ratio", "higher", "Risk-adjusted", "Like Sharpe, but divides by downside deviation only."),
  m("sortino_5y", "Sortino ratio (5Y)", "Sortino 5Y", "ratio", "higher", "Risk-adjusted", "Like Sharpe, but divides by downside deviation only."),
  m("calmar_3y", "Calmar ratio (3Y)", "Calmar 3Y", "ratio", "higher", "Risk-adjusted", "3-year CAGR ÷ |max drawdown|."),

  m("alpha_3y_category", "Alpha vs category (3Y)", "α cat", "ret", "higher", "Benchmark", "Annualised regression alpha against the equal-weighted category index."),
  m("beta_3y_category", "Beta vs category (3Y)", "β cat", "ratio", "neither", "Benchmark", "Sensitivity to the category index."),
  m("r_squared_3y_category", "R² vs category (3Y)", "R² cat", "ratio", "neither", "Benchmark", "Share of return variance explained by the category index."),
  m("information_ratio_3y_category", "Information ratio vs category (3Y)", "IR cat", "ratio", "higher", "Benchmark", "Active return ÷ tracking error against the category index."),
  m("tracking_error_3y_category", "Tracking error vs category (3Y)", "TE cat", "pct", "neither", "Benchmark", "Annualised volatility of the return difference to the category index."),
  m("up_capture_3y_category", "Up-capture vs category (3Y)", "Up cap", "ratio", "higher", "Benchmark", "Fund return ÷ category return in periods the category rose."),
  m("down_capture_3y_category", "Down-capture vs category (3Y)", "Down cap", "ratio", "lower", "Benchmark", "Fund return ÷ category return in periods the category fell."),
  m("batting_average_3y_category", "Batting average vs category (3Y)", "Bat avg", "pct", "higher", "Benchmark", "Share of periods the fund matched or beat the category."),
  m("alpha_3y_index", "Alpha vs index (3Y)", "α idx", "ret", "higher", "Benchmark", "Annualised regression alpha against the category's benchmark index fund."),
  m("beta_3y_index", "Beta vs index (3Y)", "β idx", "ratio", "neither", "Benchmark", "Sensitivity to the benchmark index fund."),
  m("excess_cagr_3y_index", "Excess CAGR vs index (3Y)", "Excess 3Y", "ret", "higher", "Benchmark", "3-year CAGR minus the benchmark index fund's 3-year CAGR."),
  m("information_ratio_3y_index", "Information ratio vs index (3Y)", "IR idx", "ratio", "higher", "Benchmark", "Active return ÷ tracking error against the benchmark index fund."),

  m("rolling_1y_median", "Median rolling 1Y return", "Roll 1Y", "ret", "higher", "Rolling", "Median of every 1-year return since inception (daily steps)."),
  m("rolling_1y_pct_negative", "Rolling 1Y: % negative", "1Y % neg", "pct", "lower", "Rolling", "Share of 1-year periods that lost money."),
  m("rolling_3y_median", "Median rolling 3Y return", "Roll 3Y", "ret", "higher", "Rolling", "Median of every 3-year CAGR since inception (daily steps)."),
  m("rolling_3y_min", "Worst rolling 3Y return", "Roll 3Y min", "ret", "higher", "Rolling", "Lowest 3-year CAGR over any period."),
  m("rolling_3y_pct_above_10", "Rolling 3Y: % above 10%", "3Y >10%", "pct", "higher", "Rolling", "Share of 3-year periods with a CAGR above 10%."),
  m("rolling_3y_pct_beat_category", "Rolling 3Y: % beating category", "3Y beat cat", "pct", "higher", "Rolling", "Share of 3-year periods the fund beat the category index."),
  m("rolling_5y_median", "Median rolling 5Y return", "Roll 5Y", "ret", "higher", "Rolling", "Median of every 5-year CAGR since inception."),
  m("rolling_5y_min", "Worst rolling 5Y return", "Roll 5Y min", "ret", "higher", "Rolling", "Lowest 5-year CAGR over any period."),

  m("sip_xirr_1y", "SIP XIRR (1Y)", "SIP 1Y", "ret", "higher", "SIP", "XIRR of a monthly SIP over the last year, valued at the latest NAV."),
  m("sip_xirr_3y", "SIP XIRR (3Y)", "SIP 3Y", "ret", "higher", "SIP", "XIRR of a monthly SIP over the last 3 years."),
  m("sip_xirr_5y", "SIP XIRR (5Y)", "SIP 5Y", "ret", "higher", "SIP", "XIRR of a monthly SIP over the last 5 years."),
  m("sip_xirr_10y", "SIP XIRR (10Y)", "SIP 10Y", "ret", "higher", "SIP", "XIRR of a monthly SIP over the last 10 years."),

  m("last_nav", "NAV", "NAV", "nav", "neither", "Price", "Latest net asset value per unit."),
  m("age_years", "Age", "Age", "years", "higher", "Price", "Years since the first NAV on record."),
  m("pct_below_52w_high", "Below 52-week high", "vs 52w hi", "pct", "lower", "Price", "How far the NAV is below its 52-week high."),
  m("direct_minus_regular_3y", "Direct − Regular (3Y)", "D−R 3Y", "ret", "neither", "Price", "3-year CAGR gap between the Direct and Regular plans: roughly the distributor commission."),
  m("idcw_yield_1y", "IDCW yield (1Y)", "IDCW yld", "pct", "neither", "Price", "Trailing-year payouts per unit ÷ current NAV (IDCW options)."),
  // Less common columns, offered in the column picker.
  m("cagr_20y", "20-year CAGR", "20Y", "ret", "higher", "Returns", CAGR),
  m("abs_return_si", "Absolute return since inception", "Abs SI", "ret", "higher", "Returns", "Total growth since the first NAV on record (not annualised)."),
  m("return_last_calendar_year", "Last calendar year", "Last yr", "ret", "higher", "Returns", "Return over the previous full calendar year."),
  m("best_month", "Best month", "Best mo", "ret", "higher", "Returns", "Highest return in a complete calendar month."),
  m("worst_month", "Worst month", "Worst mo", "ret", "higher", "Returns", "Lowest return in a complete calendar month."),
  m("longest_up_streak_months", "Longest winning streak", "Up streak", "int", "higher", "Returns", "Most consecutive months with a positive return."),
  m("longest_down_streak_months", "Longest losing streak", "Down streak", "int", "lower", "Returns", "Most consecutive months with a negative return."),
  m("volatility_5y_monthly", "Volatility (5Y, monthly)", "Vol 5Y (m)", "pct", "lower", "Risk", "Standard deviation of monthly returns ×√12 over 5 years."),
  m("days_since_ath", "Days since all-time high", "Days < ATH", "int", "lower", "Risk", "Calendar days since the NAV last set a record."),
  m("sortino_1y", "Sortino ratio (1Y)", "Sortino 1Y", "ratio", "higher", "Risk-adjusted", "Like Sharpe, but divides by downside deviation only."),
  m("sortino_3y_monthly", "Sortino ratio (3Y, monthly)", "Sortino 3Y (m)", "ratio", "higher", "Risk-adjusted", "Sortino on monthly returns — comparable with Morningstar and Value Research."),
  m("sharpe_5y_monthly", "Sharpe ratio (5Y, monthly)", "Sharpe 5Y (m)", "ratio", "higher", "Risk-adjusted", "Sharpe on monthly returns over 5 years."),
  m("r_squared_3y_index", "R² vs index (3Y)", "R² idx", "ratio", "neither", "Benchmark", "Share of return variance explained by the benchmark index fund."),
  m("tracking_error_3y_index", "Tracking error vs index (3Y)", "TE idx", "pct", "neither", "Benchmark", "Annualised volatility of the return difference to the benchmark index fund."),
  m("up_capture_3y_index", "Up-capture vs index (3Y)", "Up cap idx", "ratio", "higher", "Benchmark", "Fund return ÷ index return in periods the index rose."),
  m("down_capture_3y_index", "Down-capture vs index (3Y)", "Down cap idx", "ratio", "lower", "Benchmark", "Fund return ÷ index return in periods the index fell."),
  m("rolling_1y_min", "Worst rolling 1Y return", "Roll 1Y min", "ret", "higher", "Rolling", "Lowest 1-year return over any period."),
  m("rolling_3y_max", "Best rolling 3Y return", "Roll 3Y max", "ret", "higher", "Rolling", "Highest 3-year CAGR over any period."),
  m("rolling_5y_pct_beat_category", "Rolling 5Y: % beating category", "5Y beat cat", "pct", "higher", "Rolling", "Share of 5-year periods the fund beat the category index."),
  m("sip_xirr_si", "SIP XIRR (since inception)", "SIP SI", "ret", "higher", "SIP", "XIRR of a monthly SIP started at inception."),
  m("ath_nav", "All-time high NAV", "ATH", "nav", "neither", "Price", "Highest NAV on record (restated across unit changes)."),
  m("pct_below_ath", "Below all-time high", "vs ATH", "pct", "lower", "Price", "How far the NAV is below its all-time high."),
  m("high_52w", "52-week high", "52w hi", "nav", "neither", "Price", "Highest NAV in the last 52 weeks."),
  m("low_52w", "52-week low", "52w lo", "nav", "neither", "Price", "Lowest NAV in the last 52 weeks."),
  m("pct_vs_sma_200", "vs 200-day average", "vs SMA200", "ret", "neither", "Price", "Latest NAV relative to its 200-day simple moving average."),
  m("direct_minus_regular_1y", "Direct − Regular (1Y)", "D−R 1Y", "ret", "neither", "Price", "1-year return gap between the Direct and Regular plans."),
  m("direct_minus_regular_5y", "Direct − Regular (5Y)", "D−R 5Y", "ret", "neither", "Price", "5-year CAGR gap between the Direct and Regular plans."),
  m("idcw_payouts_1y", "IDCW paid per unit (1Y)", "IDCW ₹/unit", "num", "neither", "Price", "Payouts per unit over the trailing year (IDCW options)."),
  m("max_gap_days", "Longest NAV gap", "Max gap", "int", "lower", "Data", "Longest stretch in days without a published NAV."),
  m("glitches_removed", "Glitches removed", "Glitches", "int", "lower", "Data", "One-day NAV spikes that reversed the next day and were excluded."),
];

export const METRIC = new Map(METRICS.map((d) => [d.key, d]));

export function metric(key: string): MetricDef {
  return (
    METRIC.get(key) ?? {
      key,
      label: key.replace(/_/g, " "),
      short: key,
      kind: "num",
      better: "neither",
      group: "Price",
      description: "",
    }
  );
}

export const GROUPS: MetricGroup[] = ["Returns", "Risk", "Risk-adjusted", "Benchmark", "Rolling", "SIP", "Price", "Data"];

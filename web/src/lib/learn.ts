// The Learn section: what every number on the site means and how it is computed. The formulas
// mirror sql/derived/ (the source of truth); `metrics` lists the fund_metrics columns a concept
// covers, so /learn#<column> jumps to its explanation.

export type Concept = {
  id: string;
  title: string;
  /** fund_metrics columns explained here (each gets an anchor). */
  metrics?: string[];
  /** Plain-language meaning. */
  meaning: string;
  /** How it is computed, in words. */
  how: string;
  /** Optional formula, shown in monospace. */
  formula?: string;
  better?: "Higher" | "Lower" | "Closer to 0" | "Depends" | "Closer to 1";
  note?: string;
};

export type Topic = { id: string; title: string; intro: string; concepts: Concept[] };

export const TOPICS: Topic[] = [
  {
    id: "basics",
    title: "Basics",
    intro: "The building blocks every other number is made of.",
    concepts: [
      {
        id: "nav",
        title: "NAV (net asset value)",
        metrics: ["last_nav", "age_years"],
        meaning:
          "The price of one unit of the fund: everything it owns, minus costs, divided by the units in issue. Funds publish it every business day; you buy and sell at it.",
        how: "Daily NAVs come from AMFI via mfapi.in. One-day glitches are removed and NAVs before a face-value change are restated, so the history is continuous (see Data quality). Age is the time since the first NAV on record.",
      },
      {
        id: "plans",
        title: "Direct vs Regular, Growth vs IDCW",
        meaning:
          "Every scheme comes in a Direct plan (bought straight from the AMC) and a Regular plan (bought through a distributor, who is paid a commission out of the fund). Both own the same portfolio; Regular is a little more expensive. The Growth option reinvests everything; IDCW options pay part of it out.",
        how: "Plans and options are read from the scheme name. Rankings compare Direct with Direct and Regular with Regular, Growth options only.",
      },
      {
        id: "categories",
        title: "Categories and peer groups",
        meaning:
          "SEBI sorts funds into categories (Large Cap, Liquid, …) by what they may hold. A fund is only meaningfully compared with others in its category.",
        how: "AMCs label categories inconsistently, so every label is mapped to one SEBI category (circular of 26 Feb 2026). A peer group is one category and one plan: active, open-ended Growth options, excluding legacy share classes, index funds, ETFs and fund-of-funds.",
      },
      {
        id: "risk-free",
        title: "Risk-free rate",
        meaning: "What you could have earned with almost no risk. Risk-adjusted measures ask how much more a fund earned than this, per unit of risk taken.",
        how: "The daily NAV return of SBI Liquid Fund (Direct), which holds very short-term paper and tracks the 91-day Treasury bill. Before 2013 a fixed 6.85% a year is used.",
      },
      {
        id: "bases",
        title: "Daily and monthly basis",
        meaning:
          "Risk can be measured from daily or monthly returns. Daily uses far more observations; monthly is the industry convention and is what Morningstar and Value Research publish.",
        how: "Daily: NAV-to-NAV returns, annualised by the number of NAVs the fund actually published per year (about 248 for equity funds, about 365 for liquid funds). Monthly: month-end NAVs, annualised with 12; a window needs every month.",
      },
    ],
  },
  {
    id: "returns",
    title: "Returns",
    intro: "How much the fund made, over different periods.",
    concepts: [
      {
        id: "absolute-return",
        title: "Absolute return",
        metrics: ["ret_1d", "ret_1w", "ret_1m", "ret_3m", "ret_6m", "ret_1y", "abs_return_si"],
        meaning: "How much the NAV grew over a period, in total. +10% means ₹10,000 became ₹11,000.",
        how: "Latest NAV ÷ NAV at the start − 1. The start NAV is the last one on or before the date N months ago; a period the fund did not exist for is left blank.",
        formula: "return = NAV_end / NAV_start − 1",
        better: "Higher",
      },
      {
        id: "cagr",
        title: "CAGR (annualised return)",
        metrics: ["cagr_2y", "cagr_3y", "cagr_5y", "cagr_7y", "cagr_10y", "cagr_15y", "cagr_20y", "cagr_si"],
        meaning:
          "The steady yearly growth rate that would turn the starting value into the ending value. Use it to compare periods of different length: 12% CAGR over 5 years means ₹10,000 became about ₹17,600.",
        how: "Used for every period longer than a year. SI is since the first NAV on record.",
        formula: "CAGR = (NAV_end / NAV_start)^(1 / years) − 1",
        better: "Higher",
      },
      {
        id: "ytd",
        title: "Year to date, financial year to date",
        metrics: ["ret_ytd", "ret_fytd"],
        meaning: "Return so far this calendar year (since 1 January), or this financial year (since 1 April).",
        how: "Measured from the last NAV of the previous calendar year (or of 31 March).",
        better: "Higher",
      },
      {
        id: "calendar",
        title: "Calendar, financial-year and monthly returns",
        metrics: ["best_calendar_year", "worst_calendar_year", "return_last_calendar_year", "best_month", "worst_month"],
        meaning: "Return in each calendar year (Jan–Dec), financial year (Apr–Mar), quarter and month. Shows how the fund behaved in good and bad years.",
        how: "From the last NAV of the previous period to the last NAV of this one. The fund's first period and the current one are marked partial; best/worst year use complete years only.",
        better: "Higher",
      },
      {
        id: "consistency",
        title: "Positive months and streaks",
        metrics: ["pct_positive_months", "longest_up_streak_months", "longest_down_streak_months"],
        meaning: "How often the fund gains, and its longest runs of gaining or losing months. A rough measure of how bumpy the ride is.",
        how: "Counted over complete calendar months since inception.",
        better: "Depends",
      },
      {
        id: "growth",
        title: "Growth of ₹10,000",
        meaning: "The charts show what ₹10,000 invested on the first day of the chosen period would be worth on each later date, so lines with different prices can be compared.",
        how: "Every line is divided by its own value on the start day and multiplied by 10,000. If a comparison line starts later, the chart starts on the first day every visible line has data.",
        formula: "value(t) = 10,000 × NAV(t) / NAV(start)",
      },
    ],
  },
  {
    id: "risk",
    title: "Risk",
    intro: "How much the value swings and how badly it can fall.",
    concepts: [
      {
        id: "volatility",
        title: "Volatility (standard deviation)",
        metrics: ["volatility_1y", "volatility_3y", "volatility_5y", "volatility_3y_monthly", "volatility_5y_monthly"],
        meaning:
          "How much returns bounce around their average, per year. 15% volatility means a typical year lands within roughly ±15% of the average year. Equity funds are usually 12–25%, liquid funds under 1%.",
        how: "Sample standard deviation of daily (or monthly) returns, annualised by √(periods per year).",
        formula: "volatility = stdev(returns) × √periods_per_year",
        better: "Lower",
      },
      {
        id: "downside-deviation",
        title: "Downside deviation",
        meaning: "Like volatility, but only counts the bad side: periods when the fund did worse than the risk-free rate.",
        how: "Every period's shortfall below the risk-free rate (zero when it did better) is squared and averaged over all periods, then annualised.",
        formula: "downside deviation = √( mean( min(R − Rf, 0)² ) × periods_per_year )",
        better: "Lower",
      },
      {
        id: "max-drawdown",
        title: "Maximum drawdown",
        metrics: ["max_drawdown_1y", "max_drawdown_3y", "max_drawdown_5y", "max_drawdown_si"],
        meaning:
          "The worst fall from a high to a later low: what you would have lost buying at the worst possible moment. −30% means ₹10,000 fell to ₹7,000 before recovering.",
        how: "For every day, the NAV is compared with the highest NAV so far in the window; the deepest gap is the maximum drawdown. The peak is the last day at that high, the bottom is the lowest point, and recovery is the first later day back at or above the peak. The fund page also lists the five deepest separate falls.",
        formula: "drawdown(t) = NAV(t) / max(NAV up to t) − 1",
        better: "Closer to 0",
      },
      {
        id: "current-drawdown",
        title: "Current drawdown, below all-time high",
        metrics: ["current_drawdown", "pct_below_ath", "days_since_ath"],
        meaning: "How far today's NAV is below the fund's best-ever NAV, and how many days since it was last there. 0% means it is at a new high.",
        how: "Latest NAV ÷ highest NAV on record − 1 (shown negative as a drawdown, positive as \"below ATH\").",
        better: "Closer to 0",
      },
      {
        id: "ulcer",
        title: "Ulcer index, average drawdown, time under water",
        metrics: ["ulcer_index_3y"],
        meaning:
          "The ulcer index captures both how deep and how long the falls were, which a single maximum drawdown misses. Time under water is the share of days spent below a previous high.",
        how: "Root-mean-square of the daily drawdown over the window. Average drawdown is the plain mean; time under water counts days with a drawdown below 0.",
        formula: "ulcer index = √( mean( drawdown(t)² ) )",
        better: "Lower",
      },
      {
        id: "var",
        title: "Value at risk (VaR) and conditional VaR",
        metrics: ["var_95_1y", "cvar_95_1y"],
        meaning:
          "VaR 95%: a one-day loss the fund exceeded on only 5% of days over the past year. CVaR (expected shortfall): the average loss on those worst 5% of days, i.e. how bad bad days are.",
        how: "Historical: the past year's daily returns are sorted; VaR is the 5th-percentile worst, CVaR the mean of everything worse. Shown as positive losses (1.2% = a 1.2% fall). VaR 99% on the fund page uses the worst 1%.",
        better: "Lower",
      },
      {
        id: "shape",
        title: "Skewness and excess kurtosis",
        metrics: ["skewness_3y", "excess_kurtosis_3y"],
        meaning:
          "Skewness: are surprises mostly good (positive) or bad (negative)? Excess kurtosis: are extreme days more common than a normal bell curve predicts (above 0 = fatter tails)?",
        how: "From daily returns over 3 years, with the same small-sample estimators as Excel's SKEW and KURT (and Morningstar).",
        better: "Depends",
      },
      {
        id: "periods",
        title: "Best and worst period, positive periods",
        meaning: "The fund's best and worst single day (daily basis) or month (monthly basis) in a window, and the share of periods with a gain.",
        how: "Read directly from the window's returns.",
      },
    ],
  },
  {
    id: "risk-adjusted",
    title: "Risk-adjusted returns",
    intro: "Return earned per unit of risk taken: two funds with the same return are not equally good if one was far bumpier.",
    concepts: [
      {
        id: "sharpe",
        title: "Sharpe ratio",
        metrics: ["sharpe_1y", "sharpe_3y", "sharpe_5y", "sharpe_3y_monthly", "sharpe_5y_monthly"],
        meaning:
          "Extra return over the risk-free rate for each unit of volatility. Above 1 is very good for equity over 3 years; below 0 means the fund lost to a liquid fund.",
        how: "Mean of (fund return − risk-free return) ÷ its standard deviation, annualised.",
        formula: "Sharpe = mean(R − Rf) / stdev(R − Rf) × √periods_per_year",
        better: "Higher",
      },
      {
        id: "sortino",
        title: "Sortino ratio",
        metrics: ["sortino_1y", "sortino_3y", "sortino_5y", "sortino_3y_monthly"],
        meaning: "Like Sharpe, but only penalises harmful volatility (falling short of the risk-free rate), not upside jumps.",
        how: "Annualised mean excess return ÷ downside deviation.",
        formula: "Sortino = mean(R − Rf) × periods_per_year / downside deviation",
        better: "Higher",
      },
      {
        id: "calmar",
        title: "Calmar ratio",
        metrics: ["calmar_3y"],
        meaning: "Annual return earned per unit of the worst fall. 1.0 means the fund's CAGR equalled its deepest drawdown.",
        how: "CAGR over the window ÷ the absolute maximum drawdown over the same window.",
        formula: "Calmar = CAGR / |max drawdown|",
        better: "Higher",
      },
      {
        id: "omega",
        title: "Omega ratio and gain/loss ratio",
        meaning:
          "Omega: total return above the risk-free rate divided by total shortfall below it (above 1 = more upside than downside). Gain/loss: total gains divided by total losses, without the risk-free hurdle.",
        how: "Sums over every period in the window.",
        formula: "Omega = Σ max(R − Rf, 0) / Σ max(Rf − R, 0)     Gain/loss = Σ gains / Σ |losses|",
        better: "Higher",
      },
    ],
  },
  {
    id: "benchmarks",
    title: "Against the benchmarks",
    intro: "Is the fund worth its fee compared with the category and with an index fund? Each statistic is computed against both.",
    concepts: [
      {
        id: "category-average",
        title: "Category average",
        meaning:
          "What the average fund in the category earned: the yardstick for an active fund. It includes funds that were later closed or merged, so past losers are not quietly dropped (no survivorship bias).",
        how: "An equal-weighted index of every peer-group fund (Direct or Regular), base 100. Each day's return is the average return of funds with a NAV on both that day and the previous index day; a day counts only if at least half the month's funds published.",
      },
      {
        id: "benchmark-index",
        title: "Benchmark index",
        meaning: "The market index SEBI/AMFI names for the category (e.g. Nifty 100 for Large Cap), i.e. what you could have had with a cheap index fund.",
        how: "Represented by an index fund that tracks that index (total-return, so dividends count). It trails the index by its small expense ratio. A level is carried over holidays for at most 7 days.",
      },
      {
        id: "excess",
        title: "Excess return",
        metrics: ["excess_cagr_3y_index"],
        meaning: "Fund CAGR minus benchmark CAGR over the same dates. Positive means the fund beat the benchmark.",
        how: "Both CAGRs use exactly the same start and end dates.",
        better: "Higher",
      },
      {
        id: "beta",
        title: "Beta",
        metrics: ["beta_3y_category", "beta_3y_index"],
        meaning: "How strongly the fund moves with the benchmark. 1.0 moves in step; 0.8 tends to move 8% when the benchmark moves 10%.",
        how: "Slope of a regression of fund excess returns (over the risk-free rate) on benchmark excess returns, daily.",
        formula: "β = cov(Rf − Rrf, Rb − Rrf) / var(Rb − Rrf)",
        better: "Depends",
      },
      {
        id: "alpha",
        title: "Alpha",
        metrics: ["alpha_3y_category", "alpha_3y_index"],
        meaning:
          "Return the fund earned beyond what its beta explains, per year: the manager's value added after allowing for the market exposure taken.",
        how: "Intercept of the same regression, annualised.",
        formula: "α = ( mean(fund excess) − β × mean(benchmark excess) ) × periods_per_year",
        better: "Higher",
      },
      {
        id: "r-squared",
        title: "Correlation and R²",
        metrics: ["r_squared_3y_category", "r_squared_3y_index"],
        meaning: "How much of the fund's movement the benchmark explains (0–1). Near 1: the fund behaves like the benchmark, and beta and alpha are reliable. Low: beta and alpha mean little.",
        how: "Correlation of daily excess returns; R² is its square.",
        better: "Depends",
      },
      {
        id: "tracking-error",
        title: "Tracking error",
        metrics: ["tracking_error_3y_category", "tracking_error_3y_index"],
        meaning: "How differently the fund behaves from the benchmark, per year. Low for index funds; high for funds that bet away from the index.",
        how: "Standard deviation of the daily return difference (fund − benchmark), annualised.",
        formula: "TE = stdev(R − Rb) × √periods_per_year",
        better: "Depends",
      },
      {
        id: "information-ratio",
        title: "Information ratio",
        metrics: ["information_ratio_3y_category", "information_ratio_3y_index"],
        meaning: "Outperformance per unit of deviation from the benchmark: how efficiently the manager's bets paid off. Above 0.5 is good.",
        how: "Annualised mean of the return difference ÷ tracking error.",
        formula: "IR = mean(R − Rb) × periods_per_year / TE",
        better: "Higher",
      },
      {
        id: "treynor",
        title: "Treynor ratio and M²",
        meaning:
          "Treynor: excess return per unit of beta (market risk) instead of total risk. M²: the fund's return if it were scaled to have the benchmark's volatility, so it can be compared with the benchmark directly in percent.",
        how: "Both are annualised from daily excess returns.",
        formula: "Treynor = mean(R − Rf) × ppy / β     M² = Sharpe × σ_benchmark + Rf",
        better: "Higher",
      },
      {
        id: "capture",
        title: "Up capture, down capture",
        metrics: ["up_capture_3y_category", "down_capture_3y_category", "up_capture_3y_index", "down_capture_3y_index"],
        meaning:
          "How much of the benchmark's rises and falls the fund caught. Up 0.9 / down 0.7 means it captured 90% of the gains but only 70% of the losses — the shape you want.",
        how: "Annualised compounded fund return over the periods the benchmark rose (or was flat) ÷ the benchmark's over the same periods; down capture uses the periods it fell. The capture ratio on the fund page is up ÷ down.",
        better: "Depends",
        note: "Up capture: higher is better. Down capture: lower is better.",
      },
      {
        id: "batting-average",
        title: "Batting average, up and down percentage",
        metrics: ["batting_average_3y_category"],
        meaning:
          "Batting average: the share of days the fund matched or beat the benchmark. Up/down percentage (fund page): the share of the benchmark's up days (or down days) on which the fund did better.",
        how: "Counted over daily returns in the window.",
        better: "Higher",
      },
    ],
  },
  {
    id: "rolling",
    title: "Rolling returns",
    intro: "A trailing return depends on one start date. Rolling returns look at every start date, which shows how reliable the fund has been.",
    concepts: [
      {
        id: "rolling-returns",
        title: "Rolling returns and their distribution",
        metrics: ["rolling_1y_median", "rolling_1y_min", "rolling_3y_median", "rolling_3y_min", "rolling_3y_max", "rolling_5y_median", "rolling_5y_min"],
        meaning:
          "For every day, the return of an investor who bought exactly 1, 3, 5 or 10 years earlier. The median is the typical outcome; the minimum is the worst any such investor got.",
        how: "For each NAV date, the annualised return from the NAV on or before the same date N years earlier (within 10 days). Percentiles interpolate like Excel's PERCENTILE.INC.",
        better: "Higher",
      },
      {
        id: "rolling-odds",
        title: "Rolling odds",
        metrics: ["rolling_1y_pct_negative", "rolling_3y_pct_above_10", "rolling_3y_pct_beat_category", "rolling_5y_pct_beat_category"],
        meaning:
          "The share of all those holding periods that lost money, returned more than a hurdle (7%, 10%, 12% or 15% a year), or beat the category average over the same dates.",
        how: "Counts over the rolling series; the category comparison uses the category index's rolling return on exactly the same days.",
        better: "Depends",
        note: "% that lost money: lower is better. The others: higher is better.",
      },
    ],
  },
  {
    id: "sip",
    title: "SIP and calculators",
    intro: "Returns as an investor putting in money every month would experience them.",
    concepts: [
      {
        id: "sip-xirr",
        title: "SIP returns and XIRR",
        metrics: ["sip_xirr_1y", "sip_xirr_3y", "sip_xirr_5y", "sip_xirr_10y", "sip_xirr_si"],
        meaning:
          "XIRR is the annual return that accounts for each instalment being invested for a different length of time. It is the right way to state a SIP's return; a simple percentage gain is not.",
        how: "₹10,000 is invested on the first NAV of each month for the N whole months before the current month (12 instalments for 1Y); units are valued at the latest NAV. XIRR solves the cash flows with Excel's convention (ACT/365).",
        formula: "Σ instalment_i × (1 + XIRR)^((today − date_i)/365) = current value",
        better: "Higher",
      },
      {
        id: "calculators",
        title: "SIP and lumpsum calculators",
        meaning: "What a SIP or a one-time investment of your choosing, over your chosen dates, would be worth today.",
        how: "SIP: your amount on the first NAV on or after the chosen day of each month. Lumpsum: bought at the first NAV on or after the chosen date. Both are valued at the latest NAV; lumpsum also shows the CAGR.",
      },
    ],
  },
  {
    id: "price",
    title: "Price and plans",
    intro: "Where the NAV stands, and what the plan choice costs.",
    concepts: [
      {
        id: "highs",
        title: "All-time high, 52-week range, moving average",
        metrics: ["ath_nav", "high_52w", "low_52w", "pct_below_52w_high", "pct_vs_sma_200"],
        meaning: "Where today's NAV sits against its record, its range over the last year, and its 200-day average (above = recent uptrend).",
        how: "Highest NAV on record; highest and lowest NAV in the last 52 weeks; latest NAV ÷ average of the last 200 NAVs − 1.",
      },
      {
        id: "direct-regular",
        title: "Direct − Regular gap",
        metrics: ["direct_minus_regular_1y", "direct_minus_regular_3y", "direct_minus_regular_5y"],
        meaning: "How much more the Direct plan earned than the Regular plan of the same portfolio, per year — roughly the distributor commission you pay in Regular.",
        how: "Direct CAGR minus Regular CAGR over the same period; shown on Direct plans.",
        better: "Depends",
      },
      {
        id: "idcw",
        title: "IDCW payouts and yield",
        metrics: ["idcw_payouts_1y", "idcw_yield_1y"],
        meaning: "IDCW options pay out part of their value. Their NAV returns exclude these payouts, so use the Growth option of the same portfolio for total returns.",
        how: "A payout is inferred when the IDCW NAV falls relative to its Growth sibling by more than 0.25% in a day; the gap is the payout per unit. Yield = last year's payouts per unit ÷ current NAV.",
      },
    ],
  },
  {
    id: "ranks",
    title: "Peer ranks and category statistics",
    intro: "How a fund compares with every other fund in its peer group.",
    concepts: [
      {
        id: "rank",
        title: "Rank, percentile and quartile",
        meaning:
          "Rank 5/36 is 5th best of 36 peers. The percentile places the fund from 100 (best) to 0 (worst); Q1 is the best quarter of the group. For volatility and drawdowns, lower is ranked better.",
        how: "Morningstar's method: funds with equal values share a rank; distinct values are ranked i = 1…n and given a percentile rank of 1 (best) up to 100 (worst); quartiles are 25-point bands of it. The site shows the scale turned round (100 = best).",
        formula: "percentile rank = 1 for the best, ⌊99 (i − 1)/(n − 1) + 1⌋ otherwise",
      },
      {
        id: "category-stats",
        title: "Category spread",
        meaning: "The median fund and the 25th and 75th percentiles of the category on each metric, plus the best fund.",
        how: "Over the peer group's latest values; percentiles interpolate like Excel's PERCENTILE.INC.",
      },
      {
        id: "fund-house",
        title: "Fund-house scores",
        meaning: "How an AMC's funds do against their own categories: the average percentile of its ranked funds, and the share of them in the top quarter.",
        how: "Averages over the AMC's peer-ranked funds on 3-year CAGR, 3-year Sharpe and median rolling 3-year return.",
      },
    ],
  },
  {
    id: "data-quality",
    title: "Data quality",
    intro: "NAV feeds have errors; these numbers show what was cleaned.",
    concepts: [
      {
        id: "cleaning",
        title: "Glitches, unit changes and gaps",
        metrics: ["glitches_removed", "max_gap_days"],
        meaning:
          "A glitch is a one-day spike that reverses the next day (a typing error). A unit change is when the AMC changes the face value (e.g. ×10), which moves the NAV without any gain or loss. Gaps are stretches with no published NAV.",
        how: "Glitches: a move of at least 20% that the next NAV undoes to within 2% is dropped. Unit changes: a one-day move of at least 75% within ~5% of a split factor (×10, ×100, 1:5…) restates earlier NAVs. Every metric uses the cleaned series.",
        better: "Lower",
      },
    ],
  },
];

export const LIMITATIONS = [
  "Only NAVs are available: no AUM, expense ratios, holdings, portfolio ratios, exit loads or fund managers.",
  "IDCW options' returns exclude payouts; use the Growth option of the same portfolio for total returns.",
  "Category history uses each fund's current category, also for years before SEBI's 2018 recategorisation.",
  "\"First NAV\" is the first NAV on record (AMFI data starts April 2006), not necessarily the launch date.",
  "Past returns do not predict future returns. Nothing here is investment advice.",
];

/** concept id for every metric key, for /learn#<key> links. */
export const CONCEPT_OF = new Map(TOPICS.flatMap((t) => t.concepts.flatMap((c) => (c.metrics ?? []).map((m) => [m, c.id] as const))));

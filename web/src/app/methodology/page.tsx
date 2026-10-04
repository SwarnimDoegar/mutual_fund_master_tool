import type { Metadata } from "next";
import { Card, PageTitle } from "@/components/ui";
import { GROUPS, METRICS } from "@/lib/metrics";

export const metadata: Metadata = {
  title: "Methodology",
  description: "How every return, risk and benchmark metric is computed from AMFI NAVs, following Morningstar's published methodology.",
};

const CONVENTIONS: [string, React.ReactNode][] = [
  [
    "Data",
    <>
      Daily NAVs for every scheme AMFI publishes (from April 2006), fetched from mfapi.in and recomputed every night. One-day spikes
      that the next NAV reverses are removed; face-value changes and unit splits are detected and earlier NAVs restated, so returns do
      not jump.
    </>,
  ],
  [
    "Returns",
    <>
      &ldquo;N years ago&rdquo; is the nearest NAV on or before that date. Absolute return up to one year, CAGR beyond. A window the fund
      did not fully exist for is left blank, never extrapolated.
    </>,
  ],
  [
    "Risk",
    <>
      Two bases. <em>Daily</em> uses NAV-to-NAV returns annualised by the observed NAVs per year (about 248 for equity funds, 365 for
      liquid funds). <em>Monthly</em> uses month-end NAVs ×√12 and is comparable with Morningstar and Value Research.
    </>,
  ],
  [
    "Risk-free rate",
    <>The daily NAV of SBI Liquid Fund (Direct), which tracks the 91-day T-bill; 6.85% a year before 2013.</>,
  ],
  [
    "Ratios",
    <>
      Sharpe = mean excess return ÷ its standard deviation × √(periods per year). Sortino divides by downside deviation. Alpha and beta
      come from regressing fund excess returns on benchmark excess returns. Up/down capture use annualised geometric returns in periods
      the benchmark is ≥ 0 or &lt; 0. Calmar = CAGR ÷ |max drawdown|.
    </>,
  ],
  [
    "Benchmarks",
    <>
      (1) An equal-weighted category index of every fund that existed each day, so there is no survivorship bias. (2) An index fund
      tracking the category&apos;s AMFI tier-1 benchmark (e.g. Large Cap → Nifty 100); it trails the TRI by roughly its expense ratio.
    </>,
  ],
  [
    "Peer groups and ranks",
    <>
      SEBI category × plan (Direct or Regular), active Growth options of open-ended schemes, excluding legacy share classes, index
      funds, ETFs and FoFs. Rank 1 is best in the metric&apos;s own direction (lower is better for volatility and drawdowns);
      funds with equal values share a rank. Percentiles and quartiles follow Morningstar: distinct values are ranked, the
      percentile runs from 100 (best) to 0 (worst), and Q1 is the best quarter.
    </>,
  ],
  [
    "SIP",
    <>
      A fixed instalment on the first NAV on or after the chosen day of each month, valued at the latest NAV; XIRR as in Excel (ACT/365).
    </>,
  ],
  [
    "Limits of NAV-only data",
    <>
      No AUM, expense ratio, holdings, portfolio ratios, exit loads or fund managers. IDCW options&apos; returns exclude payouts — use
      the Growth option of the same portfolio. Category history uses each fund&apos;s current category. &ldquo;First NAV&rdquo; is the first
      NAV on record, not necessarily the launch date.
    </>,
  ],
];

export default function MethodologyPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageTitle title="Methodology" subtitle="Formulas follow Morningstar's published methodology, which Value Research also uses for Indian funds." />
      <Card title="Conventions">
        <dl className="space-y-4 text-sm">
          {CONVENTIONS.map(([k, v]) => (
            <div key={k} className="grid gap-1 sm:grid-cols-[11rem_1fr]">
              <dt className="font-medium">{k}</dt>
              <dd className="text-muted">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
      {GROUPS.map((g) => (
        <Card key={g} title={g} id={g.toLowerCase()}>
          <dl className="divide-y divide-border text-sm">
            {METRICS.filter((m) => m.group === g).map((m) => (
              <div key={m.key} id={m.key} className="grid gap-1 py-2 sm:grid-cols-[16rem_1fr]">
                <dt className="font-medium">
                  {m.label} <code className="ml-1 text-xs font-normal text-faint">{m.key}</code>
                </dt>
                <dd className="text-muted">{m.description}</dd>
              </div>
            ))}
          </dl>
        </Card>
      ))}
    </div>
  );
}

import Link from "next/link";
import { Card, Empty, Value } from "@/components/ui";
import { api } from "@/lib/api/server";
import type { RiskRow } from "@/lib/api/types";
import type { ValueKind } from "@/lib/format";

type Field = { key: keyof RiskRow; label: string; kind: ValueKind; hint: string; learn: string };

const FIELDS: Field[] = [
  { key: "cagr", label: "CAGR", kind: "ret", hint: "Annualised return over the window", learn: "cagr" },
  { key: "volatility", label: "Volatility", kind: "pct", hint: "Annualised standard deviation of returns", learn: "volatility" },
  { key: "downside_deviation", label: "Downside deviation", kind: "pct", hint: "Volatility of returns below the risk-free rate", learn: "downside-deviation" },
  { key: "sharpe", label: "Sharpe", kind: "ratio", hint: "Mean excess return ÷ volatility of excess returns", learn: "sharpe" },
  { key: "sortino", label: "Sortino", kind: "ratio", hint: "Mean excess return ÷ downside deviation", learn: "sortino" },
  { key: "calmar", label: "Calmar", kind: "ratio", hint: "CAGR ÷ |max drawdown|", learn: "calmar" },
  { key: "omega", label: "Omega", kind: "ratio", hint: "Gains above the risk-free rate ÷ losses below it", learn: "omega" },
  { key: "max_drawdown", label: "Max drawdown", kind: "pct", hint: "Deepest fall from a running high", learn: "max-drawdown" },
  { key: "ulcer_index", label: "Ulcer index", kind: "pct", hint: "Root-mean-square drawdown", learn: "ulcer" },
  { key: "pct_time_underwater", label: "Time under water", kind: "pct", hint: "Share of days below a previous high", learn: "ulcer" },
  { key: "var_95", label: "VaR 95%", kind: "pct", hint: "Loss exceeded in 5% of periods", learn: "var" },
  { key: "cvar_95", label: "CVaR 95%", kind: "pct", hint: "Average loss in the worst 5% of periods", learn: "var" },
  { key: "best_period", label: "Best period", kind: "ret", hint: "Best single day (daily) or month (monthly)", learn: "periods" },
  { key: "worst_period", label: "Worst period", kind: "ret", hint: "Worst single day (daily) or month (monthly)", learn: "periods" },
  { key: "pct_positive", label: "Positive periods", kind: "pct", hint: "Share of periods with a gain", learn: "periods" },
  { key: "gain_loss_ratio", label: "Gain/loss ratio", kind: "ratio", hint: "Average gain ÷ average loss", learn: "omega" },
  { key: "skewness", label: "Skewness", kind: "ratio", hint: "Negative: fatter left tail", learn: "shape" },
  { key: "excess_kurtosis", label: "Excess kurtosis", kind: "ratio", hint: "Tail heaviness vs a normal distribution", learn: "shape" },
];

function RiskTable({ rows }: { rows: RiskRow[] }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:-mx-5">
      <table className="table">
        <thead>
          <tr>
            <th>Metric</th>
            {rows.map((r) => (
              <th key={r.period} className="r">
                {r.period}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {FIELDS.map((f) => (
            <tr key={f.key}>
              <td>
                <Link href={`/learn#${f.learn}`} title={f.hint} className="underline decoration-border decoration-dotted underline-offset-4 hover:text-brand">
                  {f.label}
                </Link>
              </td>
              {rows.map((r) => (
                <td key={r.period} className="r">
                  <Value v={r[f.key] as number | null | undefined} kind={f.kind} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export async function RiskSection({ code }: { code: number }) {
  const res = await api<RiskRow[]>(`/v1/schemes/${code}/risk`);
  const daily = (res?.data ?? []).filter((r) => r.basis === "daily");
  const monthly = (res?.data ?? []).filter((r) => r.basis === "monthly");
  return (
    <Card
      id="risk"
      title="Risk and risk-adjusted returns"
      subtitle="Daily NAV returns, annualised by the observed NAVs per year; risk-free rate from a liquid fund's NAV."
    >
      {daily.length === 0 ? <Empty>Needs at least a year of NAVs.</Empty> : <RiskTable rows={daily} />}
      {monthly.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium">Monthly basis (comparable with Morningstar and Value Research)</summary>
          <div className="mt-3">
            <RiskTable rows={monthly} />
          </div>
        </details>
      )}
    </Card>
  );
}

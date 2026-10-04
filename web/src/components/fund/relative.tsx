import { Card, Empty, Value } from "@/components/ui";
import { api } from "@/lib/api/server";
import type { RelativeRow, Scheme } from "@/lib/api/types";
import type { ValueKind } from "@/lib/format";

type Field = { key: keyof RelativeRow; label: string; kind: ValueKind; hint: string };

const FIELDS: Field[] = [
  { key: "benchmark_cagr", label: "Benchmark CAGR", kind: "ret", hint: "Annualised benchmark return over the same dates" },
  { key: "excess_cagr", label: "Excess CAGR", kind: "ret", hint: "Fund CAGR minus benchmark CAGR" },
  { key: "alpha", label: "Alpha", kind: "ret", hint: "Annualised intercept of fund excess returns regressed on benchmark excess returns" },
  { key: "beta", label: "Beta", kind: "ratio", hint: "Sensitivity to benchmark moves" },
  { key: "r_squared", label: "R²", kind: "ratio", hint: "Share of fund variance explained by the benchmark" },
  { key: "tracking_error", label: "Tracking error", kind: "pct", hint: "Annualised volatility of the return difference" },
  { key: "information_ratio", label: "Information ratio", kind: "ratio", hint: "Active return ÷ tracking error" },
  { key: "treynor", label: "Treynor", kind: "ratio", hint: "Excess return per unit of beta" },
  { key: "m_squared", label: "M²", kind: "ret", hint: "Fund return scaled to the benchmark's volatility" },
  { key: "up_capture", label: "Up capture", kind: "ratio", hint: "Fund return ÷ benchmark return when the benchmark is up (≥ 0)" },
  { key: "down_capture", label: "Down capture", kind: "ratio", hint: "Fund return ÷ benchmark return when the benchmark is down (lower is better)" },
  { key: "batting_average", label: "Batting average", kind: "pct", hint: "Share of periods the fund matched or beat the benchmark" },
];

const BENCHMARKS = [
  ["category", "Category average"],
  ["index", "Benchmark index"],
] as const;

export async function RelativeSection({ s }: { s: Scheme }) {
  const res = await api<RelativeRow[]>(`/v1/schemes/${s.scheme_code}/relative`, { basis: "daily" });
  const rows = res?.data ?? [];
  const groups = BENCHMARKS.map(([b, label]) => ({ b, label, rows: rows.filter((r) => r.benchmark === b) })).filter((g) => g.rows.length);
  const columns = groups.flatMap((g) => g.rows.map((r, i) => ({ g, r, first: i === 0 })));

  return (
    <Card
      id="benchmark"
      title="Against the benchmarks"
      subtitle={
        <>
          Daily returns. Hover a metric for its definition.
          {groups.map((g) => (
            <span key={g.b} className="block">
              {g.label}: {g.rows[0]?.benchmark_name}
            </span>
          ))}
        </>
      }
    >
      {groups.length === 0 ? (
        <Empty>Needs at least a year of NAVs and a benchmark for this category.</Empty>
      ) : (
        <div className="-mx-4 overflow-x-auto sm:-mx-5">
          <table className="table">
            <thead>
              <tr>
                <th />
                {groups.map((g) => (
                  <th key={g.b} colSpan={g.rows.length} className="border-l border-border !text-center !text-text">
                    {g.label}
                  </th>
                ))}
              </tr>
              <tr>
                <th>Metric</th>
                {columns.map(({ g, r, first }) => (
                  <th key={`${g.b}${r.period}`} className={`r ${first ? "border-l border-border" : ""}`}>
                    {r.period}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FIELDS.map((f) => (
                <tr key={f.key}>
                  <td title={f.hint} className="cursor-help">
                    {f.label}
                  </td>
                  {columns.map(({ g, r, first }) => (
                    <td key={`${g.b}${r.period}`} className={`r ${first ? "border-l" : ""}`}>
                      <Value v={r[f.key] as number | null | undefined} kind={f.kind} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

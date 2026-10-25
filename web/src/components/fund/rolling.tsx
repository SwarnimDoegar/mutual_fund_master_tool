import { RollingChart } from "@/components/charts/rolling-chart";
import { Card, Empty, Pct } from "@/components/ui";
import { api } from "@/lib/api/server";
import type { RollingPoint, RollingRow } from "@/lib/api/types";
import { pct } from "@/lib/format";
import { packRolling } from "@/lib/packed";

export async function RollingSection({ code, v }: { code: number; v: string }) {
  const dist = await api<RollingRow[]>(`/v1/schemes/${code}/rolling`, undefined, v);
  const rows = (dist?.data ?? []).filter((r) => r.n_periods > 0);
  if (!rows.length) {
    return (
      <Card id="rolling" title="Rolling returns">
        <Empty>Needs more than a year of NAVs.</Empty>
      </Card>
    );
  }
  const periods = rows.map((r) => r.period);
  const initialPeriod = periods.includes("3Y") ? "3Y" : periods[0];
  const series = await api<RollingPoint[]>(`/v1/schemes/${code}/rolling/${initialPeriod}`, { interval: "week" }, v);

  return (
    <Card
      id="rolling"
      title="Rolling returns"
      subtitle="Returns over every possible holding period of a fixed length since the fund started — a fairer picture than a single start date."
    >
      <RollingChart code={code} periods={periods} initial={packRolling(initialPeriod, series?.data ?? [])} />
      <div className="-mx-4 mt-6 overflow-x-auto sm:-mx-5">
        <table className="table">
          <thead>
            <tr>
              <th title="Holding period">Held for</th>
              <th className="r">Worst</th>
              <th className="r">25th pct</th>
              <th className="r">Median</th>
              <th className="r">75th pct</th>
              <th className="r">Best</th>
              <th className="r" title="Share of holding periods that lost money">% lost money</th>
              <th className="r" title="Share of holding periods with a return above 10% a year">% above 10%</th>
              <th className="r" title="Median rolling return of the category average">Cat. median</th>
              <th className="r" title="Share of holding periods in which the fund beat the category average">% beat cat.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.period}>
                <td className="font-medium" title={`${r.n_periods.toLocaleString("en-IN")} periods`}>{r.period}</td>
                <td className="r"><Pct v={r.min_return} /></td>
                <td className="r"><Pct v={r.p25} /></td>
                <td className="r"><Pct v={r.median} className="font-semibold" /></td>
                <td className="r"><Pct v={r.p75} /></td>
                <td className="r"><Pct v={r.max_return} /></td>
                <td className="r num">{pct(r.pct_negative)}</td>
                <td className="r num">{pct(r.pct_above_10)}</td>
                <td className="r"><Pct v={r.category_median} /></td>
                <td className="r num">{pct(r.pct_beat_category)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

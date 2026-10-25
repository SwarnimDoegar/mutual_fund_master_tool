import { TimeChart } from "@/components/charts/time-chart";
import { Card, Empty } from "@/components/ui";
import { api } from "@/lib/api/server";
import type { Drawdown, DrawdownPoint } from "@/lib/api/types";
import { date, int, pct } from "@/lib/format";
import { packPoints } from "@/lib/packed";

export async function DrawdownSection({ code, v }: { code: number; v: string }) {
  const [episodes, series] = await Promise.all([
    api<Drawdown[]>(`/v1/schemes/${code}/drawdowns`, undefined, v),
    api<DrawdownPoint[]>(`/v1/schemes/${code}/drawdowns/series`, { interval: "week" }, v),
  ]);
  const points = packPoints((series?.data ?? []).map((p) => ({ date: p.date, value: p.drawdown })), 5);
  const rows = episodes?.data ?? [];

  return (
    <Card
      id="drawdowns"
      title="Drawdowns"
      subtitle="How far the NAV had fallen from its highest value up to each date. 0% means it was at a new high; −30% means an investor who bought at the previous peak was down 30%. Weekly lows."
    >
      {(series?.data.length ?? 0) < 2 ? (
        <Empty>Not enough history.</Empty>
      ) : (
        <TimeChart
          series={[{ name: "Below the previous high", points, fill: "below" }]}
          format="pct"
          height={220}
          title="Latest:"
          hoverTitle="Week ending {date}:"
          ariaLabel="Underwater chart: percentage below the all-time high over time"
        />
      )}
      {rows.length > 0 && (
        <div className="panel-table mt-6">
          <h3 className="px-4 pb-1 text-sm font-medium">The five deepest falls</h3>
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th className="r" title="Fall from the peak to the lowest point">Fall</th>
                <th title="Date of the high before the fall">Peak</th>
                <th title="Date of the lowest point">Bottom</th>
                <th title="First date back at the old peak">Recovered</th>
                <th className="r" title="Calendar days from peak to bottom">Days falling</th>
                <th className="r" title="Calendar days from bottom back to the old peak">Days to recover</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.rank}>
                  <td className="text-muted">{r.rank}</td>
                  <td className="r num font-semibold text-neg">{pct(r.depth)}</td>
                  <td>{date(r.peak_date)}</td>
                  <td>{date(r.trough_date)}</td>
                  <td>{r.recovery_date ? date(r.recovery_date) : <span className="text-warn">Not yet</span>}</td>
                  <td className="r num">{int(r.decline_days)} d</td>
                  <td className="r num">{r.recovery_days != null ? `${int(r.recovery_days)} d` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

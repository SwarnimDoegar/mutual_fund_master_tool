import { Card, Empty } from "@/components/ui";
import { api } from "@/lib/api/server";
import type { Payout, Quality, Scheme } from "@/lib/api/types";
import { date, int, pct } from "@/lib/format";

export async function QualityCard({ code }: { code: number }) {
  const res = await api<Quality>(`/v1/schemes/${code}/quality`);
  if (!res) return null;
  const q = res.data;
  const rows: [string, string][] = [
    ["NAV dates", `${int(q.clean_dates)} of ${int(q.raw_dates)}`],
    ["History", `${date(q.first_date)} – ${date(q.last_date)}`],
    ["Longest gap", `${int(q.max_gap_days)} days`],
    ["Gaps over 30 days", int(q.gaps_over_30d)],
    ["Glitches removed", int(q.glitches_removed)],
    ["Unit changes restated", int(q.unit_changes)],
    ["Largest one-day move", `${pct(q.largest_move)} on ${date(q.largest_move_date)}`],
  ];
  return (
    <Card title="Data quality" subtitle="How clean this fund's NAV history is.">
      <dl className="space-y-1.5 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-muted">{k}</dt>
            <dd className="num text-right">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

export async function PayoutsCard({ s }: { s: Scheme }) {
  const res = await api<Payout[]>(`/v1/schemes/${s.scheme_code}/payouts`);
  const rows = (res?.data ?? []).slice(-12).reverse();
  return (
    <Card title="IDCW payouts" subtitle="Inferred from the gap to the Growth option of the same portfolio.">
      {rows.length === 0 ? (
        <Empty>No payouts detected.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th className="r">Per unit</th>
              <th className="r">% of NAV</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date}>
                <td>{date(r.date)}</td>
                <td className="r num">₹{r.payout_per_unit.toFixed(4)}</td>
                <td className="r num">{pct(r.payout_pct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {s.idcw_yield_1y != null && <p className="mt-3 text-xs text-muted">Trailing-year yield: {pct(s.idcw_yield_1y)}</p>}
    </Card>
  );
}

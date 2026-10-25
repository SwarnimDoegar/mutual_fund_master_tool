import { Card, Empty, Pct, Quartile } from "@/components/ui";
import { api, apiOptional, seg } from "@/lib/api/server";
import type { CategoryStat, RankRow, Scheme, TrailingReturn } from "@/lib/api/types";
import { date, nav } from "@/lib/format";

/** Trailing horizon → the ranked `fund_metrics` column with the same value. */
const HORIZON_METRIC: Record<string, string> = {
  "1M": "ret_1m",
  "3M": "ret_3m",
  "6M": "ret_6m",
  YTD: "ret_ytd",
  "1Y": "ret_1y",
  "3Y": "cagr_3y",
  "5Y": "cagr_5y",
  "10Y": "cagr_10y",
};

export async function ReturnsSection({ s, v }: { s: Scheme; v: string }) {
  const [ret, ranks, stats] = await Promise.all([
    api<TrailingReturn[]>(`/v1/schemes/${s.scheme_code}/returns`, undefined, v),
    apiOptional<RankRow[]>(`/v1/schemes/${s.scheme_code}/ranks`, undefined, v),
    s.category && s.plan
      ? apiOptional<CategoryStat[]>(`/v1/categories/${seg(s.category)}/stats`, { plan: s.plan }, v)
      : null,
  ]);
  const rankBy = new Map((ranks?.data ?? []).map((r) => [r.metric, r]));
  const statBy = new Map((stats?.data ?? []).map((r) => [r.metric, r]));
  const rows = (ret?.data ?? []).filter((r) => r.abs_return != null);

  return (
    <Card
      id="returns"
      title="Trailing returns"
      subtitle={`Absolute up to 1 year, CAGR beyond. Category figures: ${s.category || "—"}, ${s.plan || "all"} plans, Growth options.`}
    >
      {rows.length === 0 ? (
        <Empty>No return history yet.</Empty>
      ) : (
        <div className="-mx-4 overflow-x-auto sm:-mx-5">
          <table className="table">
            <thead>
              <tr>
                <th>Period</th>
                <th className="r">Fund</th>
                <th className="r">Category median</th>
                <th className="r">Category best</th>
                <th className="r">Rank</th>
                <th>Quartile</th>
                <th className="r hidden sm:table-cell">From</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = HORIZON_METRIC[r.horizon];
                const rank = key ? rankBy.get(key) : undefined;
                const stat = key ? statBy.get(key) : undefined;
                const value = r.cagr ?? r.abs_return;
                return (
                  <tr key={r.horizon}>
                    <td className="font-medium">
                      {r.horizon}
                      {r.cagr != null && <span className="ml-1 text-xs text-muted">p.a.</span>}
                    </td>
                    <td className="r">
                      <Pct v={value} className="font-semibold" />
                    </td>
                    <td className="r">
                      <Pct v={stat?.median} />
                    </td>
                    <td className="r">
                      <Pct v={stat?.max_value} />
                    </td>
                    <td className="r num">{rank ? `${rank.rank} / ${rank.peers}` : <span className="text-faint">—</span>}</td>
                    <td>
                      <Quartile q={rank?.quartile} />
                    </td>
                    <td className="r hidden text-xs text-muted sm:table-cell" title={`NAV ${nav(r.start_nav)}`}>
                      {date(r.start_date)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

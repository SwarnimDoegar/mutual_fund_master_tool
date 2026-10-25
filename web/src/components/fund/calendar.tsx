import clsx from "clsx";
import { Card, Empty } from "@/components/ui";
import { api } from "@/lib/api/server";
import type { CalendarReturn } from "@/lib/api/types";
import { pct } from "@/lib/format";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Background for a monthly-return heatmap cell, saturating at ±8%. */
function heat(v: number | null | undefined): React.CSSProperties | undefined {
  if (v == null) return undefined;
  const a = Math.min(1, Math.abs(v) / 0.08) * 0.55 + 0.08;
  return { background: `color-mix(in srgb, var(${v >= 0 ? "--pos" : "--neg"}) ${Math.round(a * 100)}%, transparent)` };
}

export async function CalendarSection({ code, v }: { code: number; v: string }) {
  const res = await api<CalendarReturn[]>(`/v1/schemes/${code}/calendar-returns`, undefined, v);
  const all = res?.data ?? [];
  const yearsRows = all.filter((r) => r.period_type === "year");
  const fy = all.filter((r) => r.period_type === "fy");
  const monthly = all.filter((r) => r.period_type === "month");
  if (!yearsRows.length) {
    return (
      <Card id="calendar" title="Calendar returns">
        <Empty>No complete periods yet.</Empty>
      </Card>
    );
  }

  const maxAbs = Math.max(...yearsRows.map((r) => Math.abs(r.ret ?? 0)), 0.01);
  type Cell = { ret: number | null; partial: boolean } | null;
  const byYear = new Map<number, Cell[]>();
  for (const r of monthly) {
    const y = Number(r.period_start.slice(0, 4));
    const m = Number(r.period_start.slice(5, 7)) - 1;
    if (!byYear.has(y)) byYear.set(y, new Array<Cell>(12).fill(null));
    byYear.get(y)![m] = { ret: r.ret ?? null, partial: Boolean(r.is_partial) };
  }
  const heatYears = [...byYear.keys()].sort((a, b) => b - a).slice(0, 10);
  const yearRet = new Map(yearsRows.map((r) => [Number(r.period_start.slice(0, 4)), r]));

  return (
    <Card
      id="calendar"
      title="Calendar returns"
      subtitle="Return in each calendar year (1 Jan – 31 Dec). * marks a partial year: the year the fund started, or the current year so far."
    >
      <div className="space-y-1.5">
        {[...yearsRows].reverse().map((r) => {
          const v = r.ret ?? 0;
          const w = (Math.abs(v) / maxAbs) * 50;
          return (
            <div key={r.period_start} className="grid grid-cols-[3.5rem_1fr_4.5rem] items-center gap-2 text-sm">
              <span className="num text-muted">
                {r.period_start.slice(0, 4)}
                {r.is_partial ? "*" : ""}
              </span>
              <div className="relative h-4">
                <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
                <div
                  className={clsx("absolute inset-y-0.5 rounded-sm", v >= 0 ? "bg-pos/70" : "bg-neg/70")}
                  style={v >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }}
                />
              </div>
              <span className={clsx("num text-right", v > 0 ? "text-pos" : v < 0 ? "text-neg" : "")}>{pct(r.ret, { signed: true })}</span>
            </div>
          );
        })}
      </div>

      {heatYears.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-medium">Monthly returns, %</h3>
          <p className="mb-2 text-xs text-muted">
            Each cell is that month&apos;s return in percent (2.50 = +2.50%). Greener is better, redder is worse; blank means no data. * marks a
            partial month or year (the fund&apos;s first, or the current one so far). The last column is the calendar-year return.
          </p>
          <div className="panel-table">
            <table className="w-full min-w-[760px] border-separate border-spacing-0.5 px-4 text-xs">
              <thead>
                <tr>
                  <th className="text-left font-medium text-muted">Year</th>
                  {MONTHS.map((m) => (
                    <th key={m} className="font-medium text-muted">
                      {m}
                    </th>
                  ))}
                  <th className="font-medium text-muted">Year</th>
                </tr>
              </thead>
              <tbody>
                {heatYears.map((y) => (
                  <tr key={y}>
                    <td className="num pr-2 text-muted">{y}</td>
                    {byYear.get(y)!.map((c, i) => (
                      <td
                        key={i}
                        className={clsx("num rounded px-1 py-1 text-center", c?.partial && "italic outline outline-1 -outline-offset-1 outline-dashed outline-border")}
                        style={heat(c?.ret)}
                        title={c?.partial ? "Partial month" : undefined}
                      >
                        {c?.ret == null ? "" : `${(c.ret * 100).toFixed(2)}${c.partial ? "*" : ""}`}
                      </td>
                    ))}
                    <td
                      className={clsx("num rounded px-1 py-1 text-center font-medium", yearRet.get(y)?.is_partial && "italic")}
                      style={heat((yearRet.get(y)?.ret ?? 0) / 4)}
                      title={yearRet.get(y)?.is_partial ? "Partial year" : undefined}
                    >
                      {yearRet.get(y)?.ret != null ? `${(yearRet.get(y)!.ret! * 100).toFixed(2)}${yearRet.get(y)!.is_partial ? "*" : ""}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {fy.length > 0 && (
        <details className="mt-6 text-sm">
          <summary className="cursor-pointer font-medium">Financial years (April–March)</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {[...fy].reverse().map((r) => {
              const y = Number(r.period_start.slice(0, 4));
              return (
                <span key={r.period_start} className="chip">
                  FY{String(y + 1).slice(2)}
                  {r.is_partial ? "*" : ""}&nbsp;<span className={clsx("num", (r.ret ?? 0) >= 0 ? "text-pos" : "text-neg")}>{pct(r.ret, { signed: true })}</span>
                </span>
              );
            })}
          </div>
        </details>
      )}
    </Card>
  );
}

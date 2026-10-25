"use client";

import { BaselineSeries, LineSeries, LineStyle, type ISeriesApi, type MouseEventParams, type Time } from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { date } from "@/lib/format";
import { unpackPoints, type PackedPoints } from "@/lib/packed";
import { disposedCharts, inrFormatter, numFormatter, pctFormatter, useChart } from "./use-chart";

export type Point = { t: string; v: number };
export type ChartSeries = {
  name: string;
  /** Packed when passed from a server component (lib/packed.ts). */
  points: Point[] | PackedPoints;
  /** Index into the theme's series palette (default: position in the list). */
  color?: number;
  /** Fill between the line and zero (underwater / excess-return charts). */
  fill?: "below" | "both";
  dashed?: boolean;
};
export type ChartFormat = "pct" | "inr" | "num";

const FORMATTERS = { pct: pctFormatter, inr: inrFormatter, num: numFormatter };

/**
 * Multi-series time chart with a legend that follows the crosshair.
 * `points` must be sorted by date (YYYY-MM-DD).
 */
export function TimeChart({
  series: given,
  format,
  height = 300,
  ariaLabel,
  showChange = false,
  title,
  hoverTitle = "On {date}",
}: {
  series: ChartSeries[];
  format: ChartFormat;
  height?: number;
  ariaLabel: string;
  /** Show each series' change from its first to its last point (total, and per year beyond a year). */
  showChange?: boolean;
  /** Legend heading for the latest values, e.g. "₹10,000 invested on 1 Oct 2021 is now worth". */
  title?: string;
  /** Legend heading while hovering; `{date}` becomes the hovered date. */
  hoverTitle?: string;
}) {
  const series = useMemo(
    () => given.map((s) => ({ ...s, points: Array.isArray(s.points) ? s.points : unpackPoints(s.points) })),
    [given],
  );
  const formatter = FORMATTERS[format];
  const { ref, chart, theme } = useChart({ localization: { priceFormatter: formatter, locale: "en-IN" } });
  const apis = useRef<ISeriesApi<"Line" | "Baseline">[]>([]);
  const [hover, setHover] = useState<{ time: string; values: (number | null)[] } | null>(null);

  useEffect(() => {
    if (!chart || !theme) return;
    apis.current = series.map((s, i) => {
      const color = theme.series[(s.color ?? i) % theme.series.length];
      const common = {
        lineWidth: 2 as const,
        priceLineVisible: false,
        lastValueVisible: series.length <= 3,
        priceFormat: { type: "custom" as const, formatter, minMove: 0.0001 },
        lineStyle: s.dashed ? LineStyle.Dashed : LineStyle.Solid,
      };
      const api = s.fill
        ? chart.addSeries(BaselineSeries, {
            ...common,
            baseValue: { type: "price", price: 0 },
            topLineColor: s.fill === "both" ? theme.pos : theme.neg,
            topFillColor1: s.fill === "both" ? `${theme.pos}40` : "transparent",
            topFillColor2: s.fill === "both" ? `${theme.pos}08` : "transparent",
            bottomLineColor: theme.neg,
            bottomFillColor1: `${theme.neg}08`,
            bottomFillColor2: `${theme.neg}50`,
          })
        : chart.addSeries(LineSeries, { ...common, color });
      api.setData(s.points.map((p) => ({ time: p.t as Time, value: p.v })));
      return api;
    });
    chart.timeScale().fitContent();
    const current = apis.current;
    return () => {
      // the whole chart may already be gone (component unmounting): nothing to remove then
      if (!disposedCharts.has(chart)) for (const a of current) chart.removeSeries(a);
      apis.current = [];
    };
  }, [chart, theme, series, formatter]);

  useEffect(() => {
    if (!chart) return;
    const onMove = (p: MouseEventParams<Time>) => {
      if (!p.time || !p.point) {
        setHover(null);
        return;
      }
      const values = apis.current.map((a) => {
        const d = p.seriesData.get(a) as { value?: number } | undefined;
        return d?.value ?? null;
      });
      setHover({ time: String(p.time), values });
    };
    chart.subscribeCrosshairMove(onMove);
    return () => chart.unsubscribeCrosshairMove(onMove);
  }, [chart]);

  const last = useMemo(() => series.map((s) => s.points.at(-1)?.v ?? null), [series]);
  const changes = useMemo(() => (showChange ? series.map(changeText) : []), [series, showChange]);
  const values = hover?.values ?? last;

  const heading = hover ? hoverTitle.replace("{date}", date(hover.time)) : title;

  return (
    <div>
      <div className="mb-2 min-h-9 space-y-1 text-xs">
        <div className="min-h-4 text-muted">{heading}</div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {series.map((s, i) => (
            <span key={s.name} className="flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-3 rounded"
                style={{ background: theme ? (s.fill ? theme.neg : theme.series[(s.color ?? i) % theme.series.length]) : undefined }}
              />
              <span className="text-muted">{s.name}</span>
              <span className="num font-semibold">{values[i] != null ? formatter(values[i]!) : "—"}</span>
              {!hover && changes[i] && <span className="num text-muted">({changes[i]})</span>}
            </span>
          ))}
        </div>
      </div>
      <div ref={ref} style={{ height }} role="img" aria-label={ariaLabel} />
    </div>
  );
}

/** "+782.6% total · 17.7% a year" from the first to the last point. */
function changeText(s: { points: Point[] }): string | null {
  const a = s.points[0];
  const b = s.points.at(-1);
  if (!a || !b || !a.v) return null;
  const total = b.v / a.v - 1;
  const years = (Date.parse(b.t) - Date.parse(a.t)) / (365.25 * 86_400_000);
  const sign = (v: number) => (v > 0 ? "+" : "");
  const t = `${sign(total)}${(total * 100).toFixed(2)}% total`;
  if (years < 1) return t;
  const cagr = Math.pow(1 + total, 1 / years) - 1;
  return `${t} · ${sign(cagr)}${(cagr * 100).toFixed(2)}% a year`;
}

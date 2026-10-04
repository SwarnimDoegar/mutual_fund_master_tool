"use client";

// TradingView Lightweight Charts™ Copyright (c) 2025 TradingView, Inc. https://www.tradingview.com/
// The on-chart logo is off: the licence's link requirement is met by the site footer, which
// links to tradingview.com on every page (src/app/layout.tsx).

import { ColorType, createChart, CrosshairMode, type DeepPartial, type ChartOptions, type IChartApi } from "lightweight-charts";
import { useEffect, useRef, useState } from "react";

export type ChartTheme = {
  text: string;
  muted: string;
  border: string;
  surface: string;
  series: string[];
  pos: string;
  neg: string;
};

function readTheme(): ChartTheme {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    text: v("--text"),
    muted: v("--muted"),
    border: v("--border"),
    surface: v("--surface"),
    series: [1, 2, 3, 4, 5].map((i) => v(`--series-${i}`)),
    pos: v("--pos"),
    neg: v("--neg"),
  };
}

function themeOptions(t: ChartTheme): DeepPartial<ChartOptions> {
  return {
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: t.muted,
      fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui",
      fontSize: 11,
      attributionLogo: false,
    },
    grid: { vertLines: { visible: false }, horzLines: { color: t.border } },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false },
    crosshair: { mode: CrosshairMode.Magnet, vertLine: { color: t.muted, labelBackgroundColor: t.text }, horzLine: { color: t.muted, labelBackgroundColor: t.text } },
  };
}

/**
 * Creates a chart in `ref`, keeps it themed with the page (light/dark) and disposes it on
 * unmount. Returns the chart and the current theme once mounted.
 */
export function useChart(options: DeepPartial<ChartOptions> = {}) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ chart: IChartApi; theme: ChartTheme } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let theme = readTheme();
    const chart = createChart(el, {
      autoSize: true,
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: false },
      ...themeOptions(theme),
      ...options,
    });
    setState({ chart, theme });

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => {
      theme = readTheme();
      chart.applyOptions(themeOptions(theme));
      setState({ chart, theme });
    };
    mq.addEventListener("change", onScheme);
    return () => {
      mq.removeEventListener("change", onScheme);
      setState(null);
      chart.remove();
    };
    // Options are applied once at creation; callers update series, not chart options.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ref, chart: state?.chart ?? null, theme: state?.theme ?? null };
}

export const pctFormatter = (v: number) => `${(v * 100).toFixed(Math.abs(v) < 0.1 ? 2 : 1)}%`;
export const inrFormatter = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
export const numFormatter = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 2 });

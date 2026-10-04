"use client";

import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { GROUPS, METRICS } from "@/lib/metrics";
import { isPercent, screenerHref, type ScreenerState } from "@/lib/screener";

type Range = { key: string; min: string; max: string };

export function ScreenerFilters({
  state,
  categories,
  fundHouses,
}: {
  state: ScreenerState;
  categories: { category: string; asset_class: string }[];
  fundHouses: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [assetClass, setAssetClass] = useState(state.filters.asset_class ?? "");
  const [category, setCategory] = useState(state.filters.category ?? "");
  const [plan, setPlan] = useState(state.filters.plan ?? "Any");
  const [house, setHouse] = useState(state.filters.fund_house ?? "");
  const [all, setAll] = useState(state.all);
  const [ranges, setRanges] = useState<Range[]>(
    Object.entries(state.ranges).map(([key, [lo, hi]]) => ({ key, min: lo?.toString() ?? "", max: hi?.toString() ?? "" })),
  );

  const classes = [...new Set(categories.map((c) => c.asset_class))];
  const visibleCats = categories.filter((c) => !assetClass || c.asset_class === assetClass);

  function apply(e?: React.FormEvent) {
    e?.preventDefault();
    const next: ScreenerState = {
      ...state,
      offset: 0,
      all,
      filters: {
        ...(assetClass && { asset_class: assetClass }),
        ...(category && { category }),
        ...(house && { fund_house: house }),
        ...(plan !== "Any" && { plan }),
      },
      ranges: Object.fromEntries(
        ranges
          .filter((r) => r.min !== "" || r.max !== "")
          .map((r) => [r.key, [r.min === "" ? null : Number(r.min), r.max === "" ? null : Number(r.max)]]),
      ),
    };
    start(() => router.push(screenerHref(next), { scroll: false }));
  }

  function reset() {
    setAssetClass("");
    setCategory("");
    setPlan("Direct");
    setHouse("");
    setAll(false);
    setRanges([]);
    start(() => router.push("/screener", { scroll: false }));
  }

  const used = new Set(ranges.map((r) => r.key));

  return (
    <form onSubmit={apply} className="card space-y-4 p-4 text-sm lg:sticky lg:top-20">
      <label className="block space-y-1">
        <span className="text-xs text-muted">Asset class</span>
        <select className="input" value={assetClass} onChange={(e) => { setAssetClass(e.target.value); setCategory(""); }}>
          <option value="">All</option>
          {classes.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-muted">Category</span>
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All</option>
          {visibleCats.map((c) => (
            <option key={c.category}>{c.category}</option>
          ))}
        </select>
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-muted">Fund house</span>
        <select className="input" value={house} onChange={(e) => setHouse(e.target.value)}>
          <option value="">All</option>
          {fundHouses.map((h) => (
            <option key={h}>{h}</option>
          ))}
        </select>
      </label>
      <fieldset className="space-y-1">
        <legend className="text-xs text-muted">Plan</legend>
        <div className="seg w-full">
          {["Direct", "Regular", "Any"].map((p) => (
            <button key={p} type="button" className="flex-1" aria-pressed={plan === p} onClick={() => setPlan(p)}>
              {p}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-xs text-muted">Metric ranges</legend>
        {ranges.map((r, i) => (
          <div key={i} className="space-y-1 rounded-lg border border-border p-2">
            <div className="flex gap-1">
              <select
                className="input py-1 text-xs"
                value={r.key}
                aria-label="Metric"
                onChange={(e) => setRanges((rs) => rs.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
              >
                {GROUPS.map((g) => (
                  <optgroup key={g} label={g}>
                    {METRICS.filter((m) => m.group === g && (m.key === r.key || !used.has(m.key))).map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <button type="button" className="btn px-2" aria-label="Remove filter" onClick={() => setRanges((rs) => rs.filter((_, j) => j !== i))}>
                <X className="size-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-1">
              <input className="input num py-1 text-xs" inputMode="decimal" placeholder="min" aria-label="Minimum" value={r.min} onChange={(e) => setRanges((rs) => rs.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)))} />
              <span className="text-faint">–</span>
              <input className="input num py-1 text-xs" inputMode="decimal" placeholder="max" aria-label="Maximum" value={r.max} onChange={(e) => setRanges((rs) => rs.map((x, j) => (j === i ? { ...x, max: e.target.value } : x)))} />
              <span className="w-4 text-xs text-muted">{isPercent(r.key) ? "%" : ""}</span>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="btn w-full"
          onClick={() => {
            const key =
              ["cagr_3y", "sharpe_3y", "volatility_3y", "max_drawdown_3y", "ret_1y"].find((k) => !used.has(k)) ??
              METRICS.find((m) => !used.has(m.key))?.key;
            if (key) setRanges((rs) => [...rs, { key, min: "", max: "" }]);
          }}
        >
          <Plus className="size-3.5" /> Add range
        </button>
      </fieldset>

      <label className="flex items-start gap-2 text-xs text-muted">
        <input type="checkbox" className="mt-0.5 accent-[var(--brand)]" checked={all} onChange={(e) => setAll(e.target.checked)} />
        Include IDCW options, index funds, ETFs, FoFs and closed-ended schemes (not peer-ranked)
      </label>

      <div className="flex gap-2">
        <button className="btn-primary flex-1" disabled={pending}>
          {pending ? "Applying…" : "Apply"}
        </button>
        <button type="button" className="btn" onClick={reset}>
          Reset
        </button>
      </div>
    </form>
  );
}

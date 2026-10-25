"use client";

import clsx from "clsx";
import { ArrowDown, ArrowUp, Columns3, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { COLUMNS_COOKIE, DEFAULT_COLUMNS, MAX_COLUMNS, PRESETS, presetOf, type PresetKey } from "@/lib/columns";
import { GROUPS, METRICS, metric } from "@/lib/metrics";

/**
 * Lets the reader choose and order a fund table's metric columns. Applying writes `?cols=` to
 * the current URL (shareable) and remembers the choice in a cookie for every fund table.
 */
export function ColumnPicker({ columns }: { columns: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<string[]>(columns);
  const [filter, setFilter] = useState("");
  const [pending, start] = useTransition();

  const active = presetOf(columns);

  function navigate(next: string[]) {
    const value = next.join(",");
    document.cookie = `${COLUMNS_COOKIE}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
    const q = new URLSearchParams(params.toString());
    q.set("cols", value);
    q.delete("offset");
    start(() => router.push(`${pathname}?${q}`, { scroll: false }));
  }

  function open() {
    setDraft(columns);
    setFilter("");
    dialog.current?.showModal();
  }

  function toggle(key: string) {
    setDraft((d) => (d.includes(key) ? d.filter((k) => k !== key) : d.length >= MAX_COLUMNS ? d : [...d, key]));
  }

  function move(i: number, by: -1 | 1) {
    setDraft((d) => {
      const j = i + by;
      if (j < 0 || j >= d.length) return d;
      const n = [...d];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  }

  const term = filter.trim().toLowerCase();
  const matches = (m: (typeof METRICS)[number]) =>
    !term || m.label.toLowerCase().includes(term) || m.key.includes(term) || m.short.toLowerCase().includes(term);

  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
      <nav aria-label="Column presets" className="seg">
        {(Object.keys(PRESETS) as PresetKey[]).map((k) => (
          <button key={k} type="button" aria-pressed={active === k} onClick={() => navigate([...PRESETS[k].columns])} disabled={pending}>
            {PRESETS[k].label}
          </button>
        ))}
      </nav>
      <button type="button" className={clsx("btn", !active && "border-brand text-brand")} onClick={open} aria-haspopup="dialog">
        <Columns3 className="size-4" aria-hidden /> Columns
        <span className="num rounded bg-surface-2 px-1.5 text-xs text-muted">{columns.length}</span>
      </button>

      <dialog
        ref={dialog}
        aria-labelledby="column-picker-title"
        className="m-auto w-[min(56rem,calc(100vw-1.5rem))] rounded-md border border-border-strong bg-surface p-0 text-text shadow-[0_16px_48px_rgb(15_23_42/0.3)] backdrop:bg-slate-950/50"
        onClick={(e) => e.target === dialog.current && dialog.current?.close()}
      >
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 id="column-picker-title" className="h-section">
              Choose columns <span className="ml-1 text-sm font-normal text-muted">{draft.length} of up to {MAX_COLUMNS}</span>
            </h2>
            <a href="/learn" target="_blank" rel="noopener" className="link ml-auto mr-3 text-xs">
              What do these mean?
            </a>
            <button type="button" className="btn px-2" aria-label="Close" onClick={() => dialog.current?.close()}>
              <X className="size-4" />
            </button>
          </div>

          <div className="grid min-h-0 flex-1 gap-0 md:grid-cols-[1fr_18rem]">
            <div className="flex min-h-0 flex-col border-border md:border-r">
              <div className="px-5 pt-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
                  <input className="input pl-8" placeholder="Filter metrics" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter metrics" />
                </div>
              </div>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-3">
                {GROUPS.map((g) => {
                  const items = METRICS.filter((m) => m.group === g && matches(m));
                  if (!items.length) return null;
                  return (
                    <fieldset key={g}>
                      <legend className="mb-1.5 label">{g}</legend>
                      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                        {items.map((m) => (
                          <label key={m.key} className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-sm hover:bg-surface-2" title={m.description}>
                            <input type="checkbox" className="mt-0.5 accent-[var(--brand)]" checked={draft.includes(m.key)} onChange={() => toggle(m.key)} />
                            <span>{m.label}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  );
                })}
              </div>
            </div>

            <div className="flex min-h-0 flex-col border-t border-border md:border-t-0">
              <h3 className="px-4 pt-3 label">Shown, in order</h3>
              <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-2 max-md:max-h-48">
                {draft.length === 0 && <li className="py-4 text-center text-sm text-muted">Pick at least one column.</li>}
                {draft.map((k, i) => (
                  <li key={k} className="flex items-center gap-1 rounded border border-border bg-surface-2 py-1 pl-2.5 pr-1 text-sm">
                    <span className="min-w-0 flex-1 truncate" title={metric(k).label}>
                      {metric(k).label}
                    </span>
                    <button type="button" className="rounded p-1 text-muted hover:text-text disabled:opacity-30" aria-label={`Move ${metric(k).label} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp className="size-3.5" />
                    </button>
                    <button type="button" className="rounded p-1 text-muted hover:text-text disabled:opacity-30" aria-label={`Move ${metric(k).label} down`} disabled={i === draft.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown className="size-3.5" />
                    </button>
                    <button type="button" className="rounded p-1 text-muted hover:text-neg" aria-label={`Remove ${metric(k).label}`} onClick={() => toggle(k)}>
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3">
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn" onClick={() => setDraft(DEFAULT_COLUMNS)}>
                Reset to default
              </button>
              <button type="button" className="btn" onClick={() => setDraft([])}>
                Clear
              </button>
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={draft.length === 0 || pending}
              onClick={() => {
                dialog.current?.close();
                navigate(draft);
              }}
            >
              Show {draft.length} columns
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}

"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { fetchApi } from "@/lib/api/browser";
import type { SchemeListRow } from "@/lib/api/types";
import { pct } from "@/lib/format";
import { fundHref } from "@/lib/slug";

type Props = {
  /** Called with the chosen scheme instead of navigating to its page. */
  onPick?: (row: SchemeListRow) => void;
  placeholder?: string;
  autoFocus?: boolean;
};

/** Search-as-you-type over scheme names, fund houses and codes (WAI-ARIA combobox). */
export function SearchBox({ onPick, placeholder = "Search funds, AMCs or scheme codes", autoFocus }: Props) {
  const router = useRouter();
  const id = useId();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<SchemeListRow[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    // Shorter input hides the list (see showList); stale rows are replaced on the next search.
    if (term.length < 2) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetchApi<SchemeListRow[]>("/v1/schemes", { q: term, active: true, limit: 8 }, ctl.signal);
        setRows(res.data);
        setActive(-1);
        setOpen(true);
      } catch {
        if (!ctl.signal.aborted) setRows([]);
      } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);

  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  function choose(row: SchemeListRow) {
    setOpen(false);
    setQ("");
    if (onPick) onPick(row);
    else router.push(fundHref(row.scheme_code, row.scheme_name));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(rows.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(-1, i - 1));
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0 && rows[active]) choose(rows[active]);
      else if (!onPick && q.trim()) {
        setOpen(false);
        router.push(`/funds?q=${encodeURIComponent(q.trim())}`);
      }
    }
  }

  const listId = `${id}-list`;
  const showList = open && q.trim().length >= 2;

  return (
    <div ref={boxRef} className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
      <input
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
        aria-label="Search mutual funds"
        className="input pl-8"
        placeholder={placeholder}
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => rows.length && setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[70vh] overflow-auto rounded-xl border border-border bg-surface p-1 shadow-lg"
        >
          {rows.length === 0 && <li className="px-3 py-2 text-sm text-muted">{loading ? "Searching…" : "No matching funds"}</li>}
          {rows.map((r, i) => (
            <li
              key={r.scheme_code}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className={`cursor-pointer rounded-lg px-3 py-2 ${i === active ? "bg-surface-2" : "hover:bg-surface-2"}`}
              onPointerDown={(e) => {
                e.preventDefault();
                choose(r);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <div className="truncate text-sm font-medium">{r.scheme_name}</div>
              <div className="mt-0.5 flex gap-3 text-xs text-muted">
                <span className="truncate">{r.category || r.fund_house}</span>
                <span className="num ml-auto shrink-0">1Y {pct(r.ret_1y)}</span>
                <span className="num shrink-0">3Y {pct(r.cagr_3y)}</span>
              </div>
            </li>
          ))}
          {!onPick && rows.length > 0 && (
            <li className="border-t border-border px-3 py-2 text-xs">
              <button type="button" className="link" onPointerDown={(e) => { e.preventDefault(); router.push(`/funds?q=${encodeURIComponent(q.trim())}`); setOpen(false); }}>
                See all results for “{q.trim()}”
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

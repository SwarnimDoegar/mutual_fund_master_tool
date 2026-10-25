import clsx from "clsx";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import Link from "next/link";
import { Empty, Value } from "@/components/ui";
import { metric } from "@/lib/metrics";
import { fundHref } from "@/lib/slug";

export type FundTableRow = {
  scheme_code: number;
  scheme_name: string;
  fund_house?: string;
  category?: string;
  plan?: string;
  option?: string;
} & Record<string, unknown>;

/** The "no metric sort" order: fund name, A to Z. */
export const UNSORTED = "scheme_name";

/**
 * Funds with a column per `fund_metrics` metric. With `sortHref`, headers link to a sorted view
 * (`sort` is the current API sort, e.g. `-cagr_3y`): a first click sorts best-first, a second
 * reverses, a third clears the sort (fund name A–Z). A bar above the table says what the table is
 * sorted by and offers "Clear sort".
 */
export function FundTable({
  rows,
  columns,
  sort,
  sortHref,
  showCategory = true,
  rankOffset,
}: {
  rows: FundTableRow[];
  columns: string[];
  sort?: string;
  sortHref?: (sort: string) => string;
  showCategory?: boolean;
  /** Show a running row number starting after this offset. */
  rankOffset?: number;
}) {
  if (!rows.length) return <Empty>No funds match.</Empty>;
  const sortKey = sort?.replace(/^-/, "");
  const desc = sort?.startsWith("-");
  const bestFirst = (c: string) => (metric(c).better === "lower" ? c : `-${c}`);
  const nextSort = (c: string) => {
    if (sortKey !== c) return bestFirst(c);
    if (sort === bestFirst(c)) return sort.startsWith("-") ? c : `-${c}`;
    return UNSORTED;
  };
  const byName = sortKey === UNSORTED;

  return (
    <>
      {sortHref && sortKey && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px] text-muted">
          {byName ? (
            <span>Sorted by fund name, {desc ? "Z to A" : "A to Z"}.</span>
          ) : (
            <>
              <span>
                Sorted by <span className="font-medium text-text">{metric(sortKey).label}</span>, {desc ? "high to low" : "low to high"}.
              </span>
              <Link href={sortHref(UNSORTED)} scroll={false} className="chip gap-1 font-semibold hover:bg-surface-2">
                <X className="size-3" aria-hidden /> Clear sort
              </Link>
            </>
          )}
        </div>
      )}
    {/* Scrolls sideways inside the card when there are more columns than fit; the fund column stays put. */}
    <div className="panel-table overscroll-x-contain">
      <table className="table">
        <thead>
          <tr>
            <th
              className="sticky left-0 z-10 min-w-56 bg-surface-2 shadow-[1px_0_0_var(--border)] sm:min-w-[24rem]"
              aria-sort={byName ? (desc ? "descending" : "ascending") : undefined}
            >
              {sortHref ? (
                <Link
                  href={sortHref(byName && !desc ? `-${UNSORTED}` : UNSORTED)}
                  scroll={false}
                  className={clsx("inline-flex items-center gap-0.5 hover:text-text", byName && "text-text")}
                  title="Sort by fund name"
                >
                  Fund
                  {byName && (desc ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUp className="size-3" aria-hidden />)}
                </Link>
              ) : (
                "Fund"
              )}
            </th>
            {columns.map((c) => {
              const d = metric(c);
              const active = sortKey === c;
              const next = nextSort(c);
              return (
                <th key={c} className="r" title={`${d.label}. ${d.description}`} aria-sort={active ? (desc ? "descending" : "ascending") : undefined}>
                  {sortHref ? (
                    <Link href={sortHref(next)} scroll={false} className={clsx("inline-flex items-center gap-0.5 hover:text-text", active && "text-text")}>
                      {d.short}
                      {active && (desc ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUp className="size-3" aria-hidden />)}
                    </Link>
                  ) : (
                    d.short
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.scheme_code} className="[&:hover>td]:bg-surface-2">
              <td className="sticky left-0 z-10 max-w-72 whitespace-normal bg-surface shadow-[1px_0_0_var(--border)] sm:max-w-[28rem]">
                <div className="flex gap-2">
                  {rankOffset !== undefined && <span className="num w-6 shrink-0 pt-px text-xs text-muted">{rankOffset + i + 1}</span>}
                  <div className="min-w-0">
                    <Link href={fundHref(r.scheme_code, r.scheme_name)} className="row-link">
                      {r.scheme_name}
                    </Link>
                    <div className="mt-0.5 truncate text-xs text-muted">
                      {[r.fund_house, showCategory ? r.category : null].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                </div>
              </td>
              {columns.map((c) => (
                <td key={c} className="r">
                  <Value v={r[c] as number | null | undefined} kind={metric(c).kind} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

export function Pagination({ total, limit, offset, href }: { total: number; limit: number; offset: number; href: (offset: number) => string }) {
  if (total <= limit) return null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
      <span className="text-muted">
        {offset + 1}–{Math.min(total, offset + limit)} of {total.toLocaleString("en-IN")}
      </span>
      <span className="flex gap-2">
        {page > 1 ? (
          <Link className="btn" href={href(Math.max(0, offset - limit))} scroll={false}>
            Previous
          </Link>
        ) : (
          <span className="btn opacity-40">Previous</span>
        )}
        <span className="self-center text-muted">
          Page {page} of {pages}
        </span>
        {page < pages ? (
          <Link className="btn" href={href(offset + limit)} scroll={false}>
            Next
          </Link>
        ) : (
          <span className="btn opacity-40">Next</span>
        )}
      </span>
    </nav>
  );
}

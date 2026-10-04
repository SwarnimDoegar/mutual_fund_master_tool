import clsx from "clsx";
import type { ReactNode } from "react";
import { formatValue, pct, tone, type ValueKind } from "@/lib/format";

export function Card({
  title,
  subtitle,
  action,
  children,
  className,
  id,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={clsx("card scroll-mt-28", className)}>
      {(title || action) && (
        <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-4 sm:px-5">
          <div>
            {title && <h2 className="h-section">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

/** A signed percentage coloured green/red. */
export function Pct({ v, digits = 2, signed = true, className }: { v: number | null | undefined; digits?: number; signed?: boolean; className?: string }) {
  return <span className={clsx("num", tone(v), className)}>{pct(v, { digits, signed })}</span>;
}

export function Value({ v, kind, className }: { v: number | null | undefined; kind: ValueKind; className?: string }) {
  if (kind === "ret") return <Pct v={v} className={className} />;
  return <span className={clsx("num", className)}>{formatValue(v, kind)}</span>;
}

export function Stat({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-xs text-muted" title={hint}>
        {label}
      </div>
      <div className="num mt-0.5 text-lg font-semibold tracking-tight">{children}</div>
    </div>
  );
}

export function Badge({ children, tone: t = "default" }: { children: ReactNode; tone?: "default" | "brand" | "warn" | "pos" | "neg" }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        t === "default" && "bg-surface-2 text-muted",
        t === "brand" && "bg-brand-soft text-brand",
        t === "warn" && "bg-warn/15 text-warn",
        t === "pos" && "bg-pos/15 text-pos",
        t === "neg" && "bg-neg/15 text-neg",
      )}
    >
      {children}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>;
}

export function Quartile({ q }: { q: number | null | undefined }) {
  if (!q) return <span className="text-faint">—</span>;
  const t = q === 1 ? "pos" : q === 4 ? "neg" : "default";
  return <Badge tone={t}>Q{q}</Badge>;
}

/** Horizontal percentile bar, 0–100 (higher is better). */
export function PercentileBar({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-faint">—</span>;
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2" title={`Percentile ${v.toFixed(0)} of 100 in its peer group (100 = best, Morningstar method)`}>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2">
        <div className={clsx("h-full rounded-full", v >= 75 ? "bg-pos" : v < 25 ? "bg-neg" : "bg-brand")} style={{ width: `${v}%` }} />
      </div>
      <span className="num w-14 text-xs text-muted">{v.toFixed(0)}/100</span>
    </div>
  );
}

export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={clsx("skeleton", className)} />;
}

export function CardSkeleton({ title, height = "h-64" }: { title?: string; height?: string }) {
  return (
    <section className="card p-4 sm:p-5" aria-busy="true">
      {title ? <h2 className="h-section mb-4">{title}</h2> : <SkeletonBlock className="mb-4 h-5 w-40" />}
      <SkeletonBlock className={clsx("w-full", height)} />
    </section>
  );
}

export function PageTitle({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

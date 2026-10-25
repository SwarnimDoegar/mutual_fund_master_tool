import clsx from "clsx";
import type { ReactNode } from "react";
import { formatValue, pct, tone, type ValueKind } from "@/lib/format";

/** A data panel: a ruled header strip (title, subtitle, the panel's own controls) over its body. */
export function Card({
  title,
  subtitle,
  action,
  children,
  className,
  bodyClassName,
  id,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={clsx("card scroll-mt-32", className)}>
      {(title || action) && (
        <div className="panel-head">
          <div className="min-w-0">
            {title && <h2 className="h-section">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={clsx("p-4", bodyClassName)}>{children}</div>
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

/** A run of labelled figures, e.g. a fund's key numbers: inline, wrapping on narrow screens. */
export function Figures({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={clsx("flex flex-wrap gap-x-8 gap-y-3", className)}>{children}</dl>;
}

export function Stat({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="label" title={hint}>
        {label}
      </dt>
      <dd className="num text-[17px] font-semibold leading-snug">{children}</dd>
    </div>
  );
}

export function Badge({ children, tone: t = "default" }: { children: ReactNode; tone?: "default" | "brand" | "warn" | "pos" | "neg" }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded border px-1.5 py-px text-xs font-semibold",
        t === "default" && "border-border-strong text-muted",
        t === "brand" && "border-brand/45 text-brand",
        t === "warn" && "border-warn/45 text-warn",
        t === "pos" && "border-pos/45 text-pos",
        t === "neg" && "border-neg/45 text-neg",
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
  return (
    <span className={clsx("inline-flex items-center rounded border border-border-strong px-1.5 py-px text-xs", q === 1 ? "font-bold text-text" : "font-semibold text-muted")}>
      Q{q}
    </span>
  );
}

/** Horizontal percentile bar, 0–100 (higher is better). */
export function PercentileBar({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-faint">—</span>;
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2" title={`Percentile ${v.toFixed(0)} of 100 in its peer group (100 = best, Morningstar method)`}>
      <div className="h-1.5 w-24 overflow-hidden rounded-sm bg-surface-2 ring-1 ring-inset ring-border">
        <div className="h-full bg-text/70" style={{ width: `${v}%` }} />
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
    <section className="card" aria-busy="true">
      <div className="panel-head">{title ? <h2 className="h-section">{title}</h2> : <SkeletonBlock className="h-5 w-40" />}</div>
      <div className="p-4">
        <SkeletonBlock className={clsx("w-full", height)} />
      </div>
    </section>
  );
}

export function PageTitle({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="h-page">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

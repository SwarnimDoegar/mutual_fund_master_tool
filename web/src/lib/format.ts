// Display formatting. Everything uses a fixed locale and UTC so server and client render the
// same text (no hydration mismatches).

const LOCALE = "en-IN";
const DASH = "—";

type Num = number | null | undefined;

const ok = (v: Num): v is number => typeof v === "number" && Number.isFinite(v);

const pctFormats = new Map<string, Intl.NumberFormat>();
function pctFormat(digits: number, signed: boolean) {
  const key = `${digits}${signed}`;
  let f = pctFormats.get(key);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, {
      style: "percent",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      signDisplay: signed ? "exceptZero" : "auto",
    });
    pctFormats.set(key, f);
  }
  return f;
}

/** 0.1234 → "12.34%" (signed: "+12.34%"). */
export function pct(v: Num, { digits = 2, signed = false } = {}): string {
  return ok(v) ? pctFormat(digits, signed).format(v) : DASH;
}

export function num(v: Num, digits = 2): string {
  return ok(v)
    ? v.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : DASH;
}

export function int(v: Num): string {
  return ok(v) ? Math.round(v).toLocaleString(LOCALE) : DASH;
}

export function nav(v: Num): string {
  return ok(v) ? `₹${num(v, 4)}` : DASH;
}

/** Rupees with Indian digit grouping: ₹12,34,567. */
export function inr(v: Num, digits = 0): string {
  return ok(v) ? `${v < 0 ? "-" : ""}₹${num(Math.abs(v), digits)}` : DASH;
}

/** ₹1.23 Cr, ₹45.6 L, ₹12,345. */
export function inrCompact(v: Num): string {
  if (!ok(v)) return DASH;
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e7) return `${sign}₹${num(a / 1e7, 2)} Cr`;
  if (a >= 1e5) return `${sign}₹${num(a / 1e5, 2)} L`;
  return inr(v);
}

const dateFmt = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat(LOCALE, { month: "short", year: "numeric", timeZone: "UTC" });

function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso.replace(" ", "T") + (iso.includes("Z") ? "" : "Z"));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "2026-10-01" → "1 Oct 2026". */
export function date(iso: string | null | undefined): string {
  const d = parseDate(iso);
  return d ? dateFmt.format(d) : DASH;
}

export function month(iso: string | null | undefined): string {
  const d = parseDate(iso);
  return d ? monthFmt.format(d) : DASH;
}

export function years(v: Num): string {
  if (!ok(v)) return DASH;
  return v < 1 ? `${Math.round(v * 12)} mo` : `${num(v, 1)} yrs`;
}

export function days(v: Num): string {
  return ok(v) ? `${int(v)} d` : DASH;
}

/** Tailwind text colour for a signed value. */
export function tone(v: Num): string {
  if (!ok(v) || v === 0) return "";
  return v > 0 ? "text-pos" : "text-neg";
}

export type ValueKind = "ret" | "pct" | "ratio" | "num" | "nav" | "inr" | "days" | "years" | "int";

export function formatValue(v: Num, kind: ValueKind): string {
  switch (kind) {
    case "ret":
      return pct(v, { signed: true });
    case "pct":
      return pct(v);
    case "ratio":
      return num(v, 2);
    case "num":
      return num(v, 2);
    case "nav":
      return nav(v);
    case "inr":
      return inr(v);
    case "days":
      return days(v);
    case "years":
      return years(v);
    case "int":
      return int(v);
  }
}

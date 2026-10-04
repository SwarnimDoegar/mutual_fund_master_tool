"use client";

import { useState } from "react";
import { fetchApi } from "@/lib/api/browser";
import { monthsBefore } from "@/lib/dates";
import type { LumpsumResult, SipResult } from "@/lib/api/types";
import { date, inr, month, pct } from "@/lib/format";

/** `iso` shifted back by `years`, but not before `floor`. */
function yearsBefore(iso: string, years: number, floor: string | null): string {
  const s = monthsBefore(iso, years * 12);
  return floor && s < floor ? floor : s;
}

function Result({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-surface-2 p-3 text-sm">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="num font-semibold">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const tone = (v: number | null | undefined) => (v == null ? "" : v >= 0 ? "text-pos" : "text-neg");

export function SipCalculator({ code, inception, asOf }: { code: number; inception: string | null; asOf?: string | null }) {
  const today = asOf ?? new Date().toISOString().slice(0, 10);
  const minMonth = inception?.slice(0, 7) ?? "2006-04";
  const [amount, setAmount] = useState(10_000);
  const [start, setStart] = useState(yearsBefore(today, 5, inception).slice(0, 7));
  const [end, setEnd] = useState("");
  const [day, setDay] = useState(1);
  const [result, setResult] = useState<SipResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetchApi<SipResult>(`/v1/schemes/${code}/sip/calculate`, { amount, start, end: end || undefined, day });
      setResult(res.data);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Calculation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={run} className="text-sm">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="space-y-1">
          <span className="text-xs text-muted">Monthly amount (₹)</span>
          <input className="input num" type="number" min={100} step={100} value={amount} onChange={(e) => setAmount(Number(e.target.value))} required />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">First instalment</span>
          <input className="input" type="month" min={minMonth} value={start} onChange={(e) => setStart(e.target.value)} required />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">Last instalment (optional)</span>
          <input className="input" type="month" min={start} value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">Day of month</span>
          <input className="input num" type="number" min={1} max={28} value={day} onChange={(e) => setDay(Number(e.target.value))} />
        </label>
      </div>
      <button className="btn-primary mt-3" disabled={busy}>
        {busy ? "Calculating…" : "Calculate"}
      </button>
      {error && <p className="mt-3 text-sm text-neg">{error}</p>}
      {result && (
        <Result
          items={[
            ["Invested", inr(result.invested)],
            ["Value", inr(result.current_value)],
            ["Gain", <span key="g" className={tone(result.gain)}>{inr(result.gain)}</span>],
            ["XIRR", <span key="x" className={tone(result.xirr)}>{pct(result.xirr)}</span>],
            ["Instalments", `${result.installments} (${month(result.first_installment)} – ${month(result.last_installment)})`],
            ["Valued on", date(result.value_date)],
          ]}
        />
      )}
    </form>
  );
}

export function LumpsumCalculator({ code, inception, asOf }: { code: number; inception: string | null; asOf?: string | null }) {
  const today = asOf ?? new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState(1_00_000);
  const [when, setWhen] = useState(yearsBefore(today, 5, inception));
  const [result, setResult] = useState<LumpsumResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetchApi<LumpsumResult>(`/v1/schemes/${code}/lumpsum/calculate`, { amount, date: when });
      setResult(res.data);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Calculation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={run} className="text-sm">
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-muted">Amount (₹)</span>
          <input className="input num" type="number" min={100} step={1000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} required />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">Invested on</span>
          <input className="input" type="date" min={inception ?? undefined} max={today} value={when} onChange={(e) => setWhen(e.target.value)} required />
        </label>
      </div>
      <button className="btn-primary mt-3" disabled={busy}>
        {busy ? "Calculating…" : "Calculate"}
      </button>
      {error && <p className="mt-3 text-sm text-neg">{error}</p>}
      {result && (
        <Result
          items={[
            ["Value", inr(result.current_value)],
            ["Gain", <span key="g" className={tone(result.gain)}>{inr(result.gain)}</span>],
            ["Absolute", pct(result.abs_return)],
            ["CAGR", result.cagr != null ? pct(result.cagr) : "—"],
            ["Bought", `${date(result.buy_date)} @ ₹${result.buy_nav.toFixed(4)}`],
            ["Valued", `${date(result.value_date)} @ ₹${result.value_nav.toFixed(4)}`],
          ]}
        />
      )}
    </form>
  );
}

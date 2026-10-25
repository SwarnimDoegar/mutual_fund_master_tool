import { SipCalculator } from "@/components/fund/calculators";
import { Card, Empty, Pct } from "@/components/ui";
import { api } from "@/lib/api/server";
import type { Scheme, SipRow } from "@/lib/api/types";
import { date, inr, inrCompact, int } from "@/lib/format";

export async function SipSection({ s, v }: { s: Scheme; v: string }) {
  const res = await api<SipRow[]>(`/v1/schemes/${s.scheme_code}/sip`, undefined, v);
  const rows = res?.data ?? [];
  return (
    <Card id="sip" title="SIP returns" subtitle="₹10,000 on the first NAV of every month, valued at the latest NAV. XIRR as in Excel.">
      {rows.length === 0 ? (
        <Empty>Not enough history for a 1-year SIP.</Empty>
      ) : (
        <div className="-mx-4 overflow-x-auto sm:-mx-5">
          <table className="table">
            <thead>
              <tr>
                <th>Tenure</th>
                <th className="r">Instalments</th>
                <th className="r">Invested</th>
                <th className="r">Value</th>
                <th className="r">Gain</th>
                <th className="r">Absolute</th>
                <th className="r">XIRR</th>
                <th className="hidden sm:table-cell">Started</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.tenure}>
                  <td className="font-medium">{r.tenure}</td>
                  <td className="r num">{int(r.installments)}</td>
                  <td className="r num">{inrCompact(r.invested)}</td>
                  <td className="r num font-medium">{inrCompact(r.current_value)}</td>
                  <td className="r num" title={inr(r.gain)}>
                    <span className={r.gain >= 0 ? "text-pos" : "text-neg"}>{inrCompact(r.gain)}</span>
                  </td>
                  <td className="r"><Pct v={r.abs_return} /></td>
                  <td className="r"><Pct v={r.xirr} className="font-semibold" /></td>
                  <td className="hidden text-muted sm:table-cell">{date(r.first_installment)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-6 border-t border-border pt-5">
        <h3 className="mb-3 text-sm font-medium">SIP calculator</h3>
        <SipCalculator code={s.scheme_code} inception={s.inception_date ?? null} asOf={s.last_nav_date} />
      </div>
    </Card>
  );
}

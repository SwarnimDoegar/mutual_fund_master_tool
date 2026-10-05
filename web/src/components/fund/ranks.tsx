import Link from "next/link";
import { Card, Empty, PercentileBar, Value } from "@/components/ui";
import { apiOptional } from "@/lib/api/server";
import type { RankRow, Scheme } from "@/lib/api/types";
import { GROUPS, metric } from "@/lib/metrics";
import { categoryHref } from "@/lib/slug";

export async function RanksCard({ s }: { s: Scheme }) {
  const res = s.peer_eligible ? await apiOptional<RankRow[]>(`/v1/schemes/${s.scheme_code}/ranks`) : null;
  // The latest-ranks form of the endpoint always carries `metric`.
  const rows = (res?.data ?? []).flatMap((r) => (r.metric ? [{ ...r, metric: r.metric }] : []));
  const sorted = rows.sort((a, b) => {
    const ga = GROUPS.indexOf(metric(a.metric).group);
    const gb = GROUPS.indexOf(metric(b.metric).group);
    return ga - gb || a.metric.localeCompare(b.metric);
  });

  return (
    <Card
      title="Peer ranks"
      subtitle={
        s.category ? (
          <>
            Against other {s.plan}-plan funds in <Link className="link" href={categoryHref(s.category)}>{s.category}</Link>. &ldquo;5/36&rdquo; = 5th best of 36. The bar is the percentile, 100 = best and 0 = worst (Morningstar&apos;s method: funds with equal values share a rank); the figure on the right is the fund&apos;s own value.
          </>
        ) : undefined
      }
    >
      {!s.peer_eligible ? (
        <Empty>Only active Growth options of open-ended funds in a ranked category are ranked.</Empty>
      ) : sorted.length === 0 ? (
        <Empty>No ranks yet.</Empty>
      ) : (
        <ul className="space-y-2.5 text-sm">
          {sorted.map((r) => {
            const d = metric(r.metric);
            return (
              <li key={r.metric} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5">
                <Link href={`/learn#${r.metric}`} className="truncate hover:text-brand" title={d.description}>
                  {d.label}
                </Link>
                <span className="num text-right text-xs text-muted">
                  {r.rank}/{r.peers}
                </span>
                <PercentileBar value={r.percentile} />
                <Value v={r.value} kind={d.kind} className="text-right text-xs" />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

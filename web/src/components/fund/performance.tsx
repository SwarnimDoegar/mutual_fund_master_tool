import { GrowthChart, type GrowthData } from "@/components/charts/growth-chart";
import { Card, Empty } from "@/components/ui";
import { api, apiOptional, seg } from "@/lib/api/server";
import type { Benchmark, CategoryIndexPoint, NavPoint, Scheme } from "@/lib/api/types";
import { alignTo } from "@/lib/series";

export async function PerformanceSection({ s }: { s: Scheme }) {
  const plan = s.plan === "Regular" ? "Regular" : "Direct";
  const [navRes, catRes, benchRes] = await Promise.all([
    api<NavPoint[]>(`/v1/schemes/${s.scheme_code}/nav`, { interval: "day" }),
    s.category ? apiOptional<CategoryIndexPoint[]>(`/v1/categories/${seg(s.category)}/index`, { plan, interval: "day" }) : null,
    api<Benchmark[]>("/v1/benchmarks"),
  ]);
  const navs = (navRes?.data ?? []).flatMap((p) => (p.nav != null ? [{ date: p.date, value: p.nav }] : []));
  const proxy = benchRes?.data.find((b) => b.category === s.category && b.proxy_scheme_code !== s.scheme_code);
  const proxyNav = proxy?.proxy_scheme_code
    ? await apiOptional<NavPoint[]>(`/v1/schemes/${proxy.proxy_scheme_code}/nav`, { interval: "day", from: navs[0]?.date })
    : null;

  const dates = navs.map((p) => p.date);
  const data: GrowthData = { dates, lines: [{ name: "This fund", color: 0, values: alignTo(dates, navs) }] };
  if (catRes?.data.length) {
    data.lines.push({
      name: `${s.category} average`,
      color: 1,
      values: alignTo(dates, catRes.data.map((p) => ({ date: p.date, value: p.level }))),
    });
  }
  const indexName = proxy?.index_name.replace(/\s*\(via .*\)$/, "");
  if (proxy && indexName && proxyNav?.data.length) {
    data.lines.push({
      name: indexName,
      color: 2,
      values: alignTo(dates, proxyNav.data.flatMap((p) => (p.nav != null ? [{ date: p.date, value: p.nav }] : []))),
    });
  }

  return (
    <Card
      id="performance"
      title="Performance"
      subtitle={
        <>
          Growth of ₹10,000 invested at the start of the chosen period, against the average {s.category} ({plan} plans)
          {indexName ? <> and the {indexName} benchmark</> : null}. Hover the chart for the value on any date.
          {proxy && (
            <span className="block">
              Benchmark line: {proxy.proxy_scheme_name}, an index fund tracking it (it trails the index by its small expense ratio).
            </span>
          )}
        </>
      }
    >
      {dates.length < 2 ? <Empty>Not enough NAV history to chart.</Empty> : <GrowthChart data={data} label={s.scheme_name} />}
    </Card>
  );
}

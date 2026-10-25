import { GrowthChart } from "@/components/charts/growth-chart";
import { Card, Empty } from "@/components/ui";
import { api, apiOptional, seg } from "@/lib/api/server";
import type { Benchmark, CategoryIndexPoint, NavPoint, Scheme } from "@/lib/api/types";
import { growthData } from "@/lib/series";

export async function PerformanceSection({ s, v }: { s: Scheme; v: string }) {
  const plan = s.plan === "Regular" ? "Regular" : "Direct";
  const [navRes, catRes, benchRes] = await Promise.all([
    api<NavPoint[]>(`/v1/schemes/${s.scheme_code}/nav`, { interval: "day" }, v),
    s.category ? apiOptional<CategoryIndexPoint[]>(`/v1/categories/${seg(s.category)}/index`, { plan, interval: "day" }, v) : null,
    api<Benchmark[]>("/v1/benchmarks", undefined, v),
  ]);
  const navs = (navRes?.data ?? []).flatMap((p) => (p.nav != null ? [{ date: p.date, value: p.nav }] : []));
  const proxy = benchRes?.data.find((b) => b.category === s.category && b.proxy_scheme_code !== s.scheme_code);
  const proxyNav = proxy?.proxy_scheme_code
    ? await apiOptional<NavPoint[]>(`/v1/schemes/${proxy.proxy_scheme_code}/nav`, { interval: "day", from: navs[0]?.date }, v)
    : null;

  const lines = [{ name: "This fund", color: 0, points: navs }];
  if (catRes?.data.length) {
    lines.push({ name: `${s.category} average`, color: 1, points: catRes.data.map((p) => ({ date: p.date, value: p.level })) });
  }
  const indexName = proxy?.index_name.replace(/\s*\(via .*\)$/, "");
  if (proxy && indexName && proxyNav?.data.length) {
    lines.push({
      name: indexName,
      color: 2,
      points: proxyNav.data.flatMap((p) => (p.nav != null ? [{ date: p.date, value: p.nav }] : [])),
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
      {navs.length < 2 ? <Empty>Not enough NAV history to chart.</Empty> : <GrowthChart data={growthData(lines)} label={s.scheme_name} />}
    </Card>
  );
}

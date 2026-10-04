import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, CardSkeleton, PageTitle, PercentileBar } from "@/components/ui";
import { fundHouses } from "@/lib/catalog";
import { pct } from "@/lib/format";
import { fundHouseHref } from "@/lib/slug";

export const metadata: Metadata = {
  title: "Fund houses",
  description: "Every Indian AMC scored by how its funds rank within their categories.",
};

export default function FundHousesPage() {
  return (
    <>
      <PageTitle title="Fund houses" subtitle="How each AMC's ranked funds do against other funds in the same category. The bars show the share of category peers its funds beat, on average (100% = best in every category)." />
      <Suspense fallback={<CardSkeleton height="h-[40rem]" />}>
        <HouseTable />
      </Suspense>
    </>
  );
}

async function HouseTable() {
  const rows = (await fundHouses()).sort((a, b) => (b.ranked_funds ?? 0) - (a.ranked_funds ?? 0) || a.fund_house.localeCompare(b.fund_house));
  return (
    <Card>
      <div className="-mx-4 overflow-x-auto sm:-mx-5">
        <table className="table">
          <thead>
            <tr>
              <th>Fund house</th>
              <th className="r">Active schemes</th>
              <th className="r">Ranked funds</th>
              <th className="r">Categories</th>
              <th title="Average share of category peers beaten on 3-year CAGR">Peers beaten, 3Y return</th>
              <th title="Average share of category peers beaten on 3-year Sharpe ratio">Peers beaten, 3Y Sharpe</th>
              <th className="r" title="Share of its ranked funds in the top quarter of their category on 3-year CAGR">Funds in top quarter</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.fund_house}>
                <td>
                  <Link className="font-medium hover:text-brand" href={fundHouseHref(h.fund_house)}>
                    {h.fund_house}
                  </Link>
                </td>
                <td className="r num">{h.active_schemes?.toLocaleString("en-IN")}</td>
                <td className="r num">{h.ranked_funds?.toLocaleString("en-IN")}</td>
                <td className="r num">{h.categories}</td>
                <td>
                  <PercentileBar value={h.avg_percentile_cagr_3y} />
                </td>
                <td>
                  <PercentileBar value={h.avg_percentile_sharpe_3y} />
                </td>
                <td className="r num">{pct(h.pct_top_quartile_cagr_3y, { digits: 0 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

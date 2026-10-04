import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Badge, CardSkeleton, PageTitle } from "@/components/ui";
import { categories, groupByAssetClass } from "@/lib/catalog";
import { categoryHref } from "@/lib/slug";

export const metadata: Metadata = {
  title: "Fund categories",
  description: "SEBI mutual fund categories with peer-group statistics, category averages and benchmark indices.",
};

export default function CategoriesPage() {
  return (
    <>
      <PageTitle title="Categories" subtitle="SEBI categories (circular of 26 Feb 2026). Each AMC label is mapped to one canonical category." />
      <Suspense fallback={<CardSkeleton height="h-[40rem]" />}>
        <CategoryList />
      </Suspense>
    </>
  );
}

async function CategoryList() {
  const groups = groupByAssetClass(await categories());
  return (
    <div className="space-y-8">
      {groups.map(([cls, rows]) => (
        <section key={cls}>
          <h2 className="h-section mb-3">{cls}</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((c) => (
              <li key={c.category}>
                <Link href={categoryHref(c.category)} className="card block h-full p-4 transition hover:border-brand">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{c.category}</span>
                    {!c.rankable && <Badge>Not ranked</Badge>}
                  </div>
                  <div className="mt-2 text-xs text-muted">
                    {c.active_schemes.toLocaleString("en-IN")} active schemes
                    {c.rankable ? ` · ${c.ranked_direct} ranked Direct, ${c.ranked_regular} Regular` : ""}
                  </div>
                  {c.benchmark_index && <div className="mt-1 truncate text-xs text-muted">Benchmark: {c.benchmark_index.replace(/\s*\(via .*\)$/, "")}</div>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

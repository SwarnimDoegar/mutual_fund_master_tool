// Category and fund-house lookups by URL slug.
import "server-only";
import { notFound } from "next/navigation";
import { api } from "./api/server";
import type { Category, FundHouse } from "./api/types";
import { slugify } from "./slug";

export async function categories(v?: string): Promise<Category[]> {
  return (await api<Category[]>("/v1/categories", undefined, v))?.data ?? [];
}

export async function categoryBySlug(slug: string): Promise<Category> {
  const found = (await categories()).find((c) => slugify(c.category) === slug);
  if (!found) notFound();
  return found;
}

export async function fundHouses(v?: string): Promise<FundHouse[]> {
  return (await api<FundHouse[]>("/v1/fund-houses", undefined, v))?.data ?? [];
}

export async function fundHouseBySlug(slug: string): Promise<FundHouse> {
  const found = (await fundHouses()).find((h) => slugify(h.fund_house) === slug);
  if (!found) notFound();
  return found;
}

export const ASSET_CLASS_ORDER = ["Equity", "Hybrid", "Debt", "Solution Oriented", "Life Cycle", "Other"];

export function groupByAssetClass(rows: Category[]): [string, Category[]][] {
  const map = new Map<string, Category[]>();
  for (const c of rows) {
    const k = c.asset_class || "Other";
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(c);
  }
  return [...map.entries()].sort(([a], [b]) => {
    const ia = ASSET_CLASS_ORDER.indexOf(a);
    const ib = ASSET_CLASS_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
}

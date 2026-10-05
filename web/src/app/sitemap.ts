import type { MetadataRoute } from "next";
import { api } from "@/lib/api/server";
import type { SchemeListRow } from "@/lib/api/types";
import { categories, fundHouses } from "@/lib/catalog";
import { SITE_URL } from "@/lib/site";
import { categoryHref, fundHouseHref, fundHref } from "@/lib/slug";

const PAGE = 500;

/** Static pages, every category and fund house, and every active scheme (~9k URLs, one file). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const first = await api<SchemeListRow[]>("/v1/schemes", { active: true, limit: PAGE, offset: 0 });
  const total = first?.meta.total ?? 0;
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, Math.ceil(total / PAGE) - 1) }, (_, i) =>
      api<SchemeListRow[]>("/v1/schemes", { active: true, limit: PAGE, offset: (i + 1) * PAGE }),
    ),
  );
  const schemes = [first, ...rest].flatMap((r) => r?.data ?? []);
  const [cats, houses] = await Promise.all([categories(), fundHouses()]);
  const url = (path: string) => `${SITE_URL}${path}`;

  return [
    ...["/", "/screener", "/categories", "/fund-houses", "/compare", "/learn"].map((p) => ({ url: url(p), changeFrequency: "daily" as const })),
    ...cats.map((c) => ({ url: url(categoryHref(c.category)), changeFrequency: "daily" as const })),
    ...houses.map((h) => ({ url: url(fundHouseHref(h.fund_house)), changeFrequency: "weekly" as const })),
    ...schemes.map((s) => ({
      url: url(fundHref(s.scheme_code, s.scheme_name)),
      lastModified: s.last_nav_date ?? undefined,
      changeFrequency: "daily" as const,
    })),
  ];
}

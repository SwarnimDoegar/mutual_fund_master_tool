export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function fundHref(code: number, name?: string | null): string {
  return name ? `/funds/${code}-${slugify(name)}` : `/funds/${code}`;
}

/** "122639-parag-parikh-..." → 122639 */
export function parseFundId(id: string): number | null {
  const m = /^(\d{1,9})(?:-|$)/.exec(id);
  return m ? Number(m[1]) : null;
}

export const categoryHref = (category: string) => `/categories/${slugify(category)}`;
export const fundHouseHref = (house: string) => `/fund-houses/${slugify(house)}`;

/** Shorter display name: drops the plan/option suffix the page shows as badges. */
export function shortName(name: string): string {
  return name
    .replace(/\s*-\s*(direct|regular)\s*(plan)?\s*-\s*(growth|idcw|dividend).*$/i, "")
    .replace(/\s*-\s*(direct|regular)\s*(plan)?\s*$/i, "")
    .trim();
}

export const SITE_NAME = "Fund Lens";
export const SITE_TAGLINE = "Every metric for every Indian mutual fund, recomputed daily from AMFI NAVs.";
export const SITE_URL = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

export const NAV_LINKS = [
  { href: "/screener", label: "Screener" },
  { href: "/categories", label: "Categories" },
  { href: "/fund-houses", label: "Fund houses" },
  { href: "/compare", label: "Compare" },
  { href: "/learn", label: "Learn" },
] as const;

/** Funds the comparison page accepts (mf-api allows up to 10). */
export const MAX_COMPARE = 6;

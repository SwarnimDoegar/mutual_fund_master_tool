import "server-only";
import { cookies } from "next/headers";
import { COLUMNS_COOKIE, DEFAULT_COLUMNS, parseColumns } from "./columns";

/** Columns for a fund table: `?cols=` first, then the saved cookie, then the default set. */
export async function resolveColumns(cols: string | string[] | undefined): Promise<string[]> {
  const fromUrl = parseColumns(Array.isArray(cols) ? cols[0] : cols);
  if (fromUrl) return fromUrl;
  const saved = (await cookies()).get(COLUMNS_COOKIE)?.value;
  return parseColumns(saved ? decodeURIComponent(saved) : null) ?? DEFAULT_COLUMNS;
}

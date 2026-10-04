import "server-only";
import type { FundTableRow } from "@/components/fund-table";
import { ApiRequestError, api } from "./api/server";
import type { Query } from "./api/types";

/** One page of /v1/screener rows; a rejected query (bad filter or column) becomes `error`. */
export async function fundRows(query: Query): Promise<{ rows: FundTableRow[]; total: number; error: string | null }> {
  try {
    const res = await api<FundTableRow[]>("/v1/screener", query);
    const rows = res?.data ?? [];
    return { rows, total: res?.meta.total ?? rows.length, error: null };
  } catch (e) {
    if (e instanceof ApiRequestError) return { rows: [], total: 0, error: e.message };
    throw e;
  }
}

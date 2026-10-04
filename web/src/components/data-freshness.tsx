import { api } from "@/lib/api/server";
import type { MetaRow } from "@/lib/api/types";
import { date } from "@/lib/format";

export async function DataFreshness() {
  const res = await api<MetaRow>("/v1/meta");
  if (!res) return null;
  return (
    <p>
      NAVs as of <span className="font-medium text-text">{date(res.data.as_of_date)}</span>
      {res.meta.data_updated_at ? <> · metrics refreshed {date(res.meta.data_updated_at)}</> : null}
    </p>
  );
}

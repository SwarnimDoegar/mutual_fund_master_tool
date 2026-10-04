"use client";

import { useRouter } from "next/navigation";
import { MAX_COMPARE } from "@/lib/site";
import { SearchBox } from "./search-box";

/** Adds the picked scheme to `/compare?codes=…`. */
export function ComparePicker({ codes }: { codes: number[] }) {
  const router = useRouter();
  if (codes.length >= MAX_COMPARE) return <p className="text-xs text-muted">Up to {MAX_COMPARE} funds can be compared.</p>;
  return (
    <SearchBox
      placeholder="Add a fund to compare"
      onPick={(row) => {
        if (codes.includes(row.scheme_code)) return;
        router.push(`/compare?codes=${[...codes, row.scheme_code].join(",")}`, { scroll: false });
      }}
    />
  );
}

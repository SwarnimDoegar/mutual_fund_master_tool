import type { ReactNode } from "react";
import { currentVersion } from "@/lib/api/server";

/**
 * Renders `children` with the data version of this request, for components cached per version
 * (`use cache` + cacheLife(VERSIONED), see lib/api/server.ts). Place it inside <Suspense>.
 */
export async function AtVersion({ children }: { children: (v: string) => ReactNode }) {
  return children(await currentVersion());
}

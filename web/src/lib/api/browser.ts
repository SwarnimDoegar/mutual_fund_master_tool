// Client-side calls go through the same-origin proxy at /api/v1 (src/app/api/v1/[...path]).
import { toQuery, type Envelope, type Query } from "./types";

export class BrowserApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function fetchApi<T>(path: string, query?: Query, signal?: AbortSignal): Promise<Envelope<T>> {
  const res = await fetch(`/api${path}${toQuery(query)}`, { signal, headers: { accept: "application/json" } });
  if (!res.ok) {
    const problem = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new BrowserApiError(res.status, problem?.detail ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as Envelope<T>;
}

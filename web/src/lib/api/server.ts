// Server-side access to mf-api.
//
// Freshness follows the API's own scheme: responses are memoised in Next's `use cache` store
// under (data version, path), and the data version is re-read from /v1/meta at most once a
// minute. When the pipeline publishes a refresh, the version changes and every page reads new
// entries; old ones age out of the LRU. `connection()` defers every read to request time, so
// nothing here runs during `next build` (the image builds without a reachable API) and every
// data-driven component must sit inside <Suspense>.
import "server-only";
import { cacheLife } from "next/cache";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { toQuery, type Envelope, type Query } from "./types";

const BASE = (process.env.MF_API_URL ?? "http://localhost:18080").replace(/\/+$/, "");

/** The API rejected the request (bad parameters); the message is safe to show. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

type Outcome =
  | { ok: true; body: Envelope<unknown> }
  | { ok: false; status: number; detail: string };

async function dataVersion(): Promise<string> {
  "use cache";
  cacheLife({ stale: 30, revalidate: 60, expire: 180 });
  const res = await fetch(`${BASE}/v1/meta`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`mf-api /v1/meta answered ${res.status}`);
  const { meta } = (await res.json()) as Envelope<unknown>;
  // Only a completed refresh changes this (mf-api's own cache generation works the same way).
  return meta.data_updated_at ?? "";
}

async function fetchVersioned(version: string, path: string): Promise<Outcome> {
  "use cache";
  // The version argument is part of the cache key; entries never need revalidation.
  cacheLife({ stale: 300, revalidate: 86_400, expire: 172_800 });
  void version;
  const res = await fetch(`${BASE}${path}`, { headers: { accept: "application/json" } });
  if (res.ok) return { ok: true, body: (await res.json()) as Envelope<unknown> };
  if (res.status === 400 || res.status === 404) {
    // Deterministic for this data version, so caching the answer is correct.
    const problem = (await res.json().catch(() => null)) as { detail?: string } | null;
    return { ok: false, status: res.status, detail: problem?.detail ?? res.statusText };
  }
  // 5xx / 503 load shedding: throw so nothing is cached and the error boundary can retry.
  throw new Error(`mf-api ${path} answered ${res.status}`);
}

async function request<T>(path: string, query?: Query): Promise<Envelope<T> | null> {
  await connection();
  const outcome = await fetchVersioned(await dataVersion(), path + toQuery(query));
  if (outcome.ok) return outcome.body as Envelope<T>;
  if (outcome.status === 404) return null;
  throw new ApiRequestError(outcome.status, outcome.detail);
}

/** GET an endpoint; `null` when the API answers 404. */
export function api<T>(path: string, query?: Query): Promise<Envelope<T> | null> {
  return request<T>(path, query);
}

/** GET an endpoint whose absence means the page itself does not exist. */
export async function apiOrNotFound<T>(path: string, query?: Query): Promise<Envelope<T>> {
  const res = await request<T>(path, query);
  if (!res) notFound();
  return res;
}

/** GET an endpoint, treating 404 and bad-request answers as "no data" for optional sections. */
export async function apiOptional<T>(path: string, query?: Query): Promise<Envelope<T> | null> {
  try {
    return await request<T>(path, query);
  } catch (e) {
    if (e instanceof ApiRequestError) return null;
    throw e;
  }
}

export const seg = encodeURIComponent;

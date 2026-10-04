"use client";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-muted">The data service did not answer in time. This is usually brief.</p>
      {error.digest && <p className="mt-1 text-xs text-faint">Reference: {error.digest}</p>}
      <button className="btn-primary mt-6" onClick={() => retry()}>
        Try again
      </button>
    </div>
  );
}

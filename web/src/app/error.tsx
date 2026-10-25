"use client";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h1 className="h-page">Something went wrong</h1>
      <p className="mt-2 text-muted">This page could not be shown. Trying again usually fixes it; if not, reload the page.</p>
      {error.digest && <p className="mt-1 text-xs text-muted">Reference: {error.digest}</p>}
      <button className="btn-primary mt-6" onClick={() => retry()}>
        Try again
      </button>
    </div>
  );
}

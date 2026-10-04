import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Not found</h1>
      <p className="mt-2 text-muted">There is no fund, category or page at this address. It may have been merged or renamed by its AMC.</p>
      <div className="mt-6 flex justify-center gap-2">
        <Link className="btn-primary" href="/">
          Home
        </Link>
        <Link className="btn" href="/screener">
          Screener
        </Link>
      </div>
    </div>
  );
}

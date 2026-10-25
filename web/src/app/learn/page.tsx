import type { Metadata } from "next";
import { PageTitle } from "@/components/ui";
import { LIMITATIONS, TOPICS, type Concept } from "@/lib/learn";
import { metric } from "@/lib/metrics";

export const metadata: Metadata = {
  title: "Learn: what every metric means",
  description:
    "Plain-language explanations of every mutual fund metric on the site — returns, CAGR, volatility, drawdowns, Sharpe, Sortino, alpha, beta, capture ratios, rolling returns, SIP XIRR and peer ranks — and exactly how each is computed.",
  alternates: { canonical: "/learn" },
};

export default function LearnPage() {
  return (
    <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <nav aria-label="Topics" className="hidden lg:block">
        <ul className="sticky top-20 max-h-[calc(100vh-6rem)] space-y-3 overflow-y-auto pb-6 text-sm">
          {TOPICS.map((t) => (
            <li key={t.id}>
              <a href={`#${t.id}`} className="font-medium hover:text-brand">
                {t.title}
              </a>
              <ul className="mt-1 space-y-0.5 border-l border-border pl-3">
                {t.concepts.map((c) => (
                  <li key={c.id}>
                    <a href={`#${c.id}`} className="block py-0.5 text-muted hover:text-text">
                      {c.title}
                    </a>
                  </li>
                ))}
              </ul>
            </li>
          ))}
          <li>
            <a href="#limitations" className="font-medium hover:text-brand">
              Limitations
            </a>
          </li>
        </ul>
      </nav>

      <div className="min-w-0 max-w-4xl">
        <PageTitle
          title="Learn"
          subtitle="What every number on this site means, and exactly how it is computed from the daily NAVs. Conventions follow Morningstar's published methodology, which Value Research also uses for Indian funds."
        />

        <div className="space-y-12">
          {TOPICS.map((t) => (
            <section key={t.id} id={t.id} className="scroll-mt-20">
              <h2 className="text-xl font-bold">{t.title}</h2>
              <p className="mt-1 text-sm text-muted">{t.intro}</p>
              <div className="card mt-4 divide-y divide-border">
                {t.concepts.map((c) => (
                  <ConceptCard key={c.id} c={c} />
                ))}
              </div>
            </section>
          ))}

          <section id="limitations" className="scroll-mt-20">
            <h2 className="text-xl font-bold">Limitations</h2>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-muted">
              {LIMITATIONS.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function ConceptCard({ c }: { c: Concept }) {
  return (
    <article id={c.id} className="scroll-mt-20 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-base font-semibold">{c.title}</h3>
        {c.better && (
          <span className="chip" title="Which direction is better">
            Better: {c.better.toLowerCase()}
          </span>
        )}
      </div>
      {c.metrics && c.metrics.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Columns explained here">
          {c.metrics.map((k) => (
            // Each column gets an anchor, so /learn#sharpe_3y lands on this card.
            <li key={k} id={k} className="scroll-mt-24">
              <span className="inline-flex rounded border border-brand/40 px-1.5 py-px text-xs font-semibold text-brand" title={k}>
                {metric(k).label}
              </span>
            </li>
          ))}
        </ul>
      )}
      <dl className="mt-3 space-y-2 text-sm">
        <div>
          <dt className="label">What it means</dt>
          <dd className="mt-0.5">{c.meaning}</dd>
        </div>
        <div>
          <dt className="label">How it&apos;s computed</dt>
          <dd className="mt-0.5 text-muted">{c.how}</dd>
        </div>
      </dl>
      {c.formula && <pre className="mt-3 overflow-x-auto rounded border border-border bg-surface-2 px-3 py-2 font-mono text-xs">{c.formula}</pre>}
      {c.note && <p className="mt-2 text-xs text-muted">{c.note}</p>}
    </article>
  );
}

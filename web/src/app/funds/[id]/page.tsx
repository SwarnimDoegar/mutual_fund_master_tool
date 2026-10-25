import type { Metadata } from "next";
import Link from "next/link";
import { cacheLife } from "next/cache";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CalendarSection } from "@/components/fund/calendar";
import { DrawdownSection } from "@/components/fund/drawdowns";
import { FundHeader } from "@/components/fund/header";
import { KeyFacts, PlanLinks } from "@/components/fund/facts";
import { PayoutsCard, QualityCard } from "@/components/fund/quality";
import { PerformanceSection } from "@/components/fund/performance";
import { RanksCard } from "@/components/fund/ranks";
import { RelativeSection } from "@/components/fund/relative";
import { ReturnsSection } from "@/components/fund/returns";
import { RiskSection } from "@/components/fund/risk";
import { RollingSection } from "@/components/fund/rolling";
import { SipSection } from "@/components/fund/sip";
import { LumpsumCalculator } from "@/components/fund/calculators";
import { Card, CardSkeleton, SkeletonBlock } from "@/components/ui";
import { VERSIONED, api, apiOrNotFound, currentVersion } from "@/lib/api/server";
import type { Scheme } from "@/lib/api/types";
import { date, pct } from "@/lib/format";
import { fundHref, parseFundId } from "@/lib/slug";

export async function generateMetadata({ params }: PageProps<"/funds/[id]">): Promise<Metadata> {
  const code = parseFundId((await params).id);
  const res = code ? await api<Scheme>(`/v1/schemes/${code}`) : null;
  if (!res) return { title: "Fund not found", robots: { index: false } };
  const s = res.data;
  const bits = [
    s.cagr_3y != null ? `3Y CAGR ${pct(s.cagr_3y)}` : null,
    s.ret_1y != null ? `1Y ${pct(s.ret_1y)}` : null,
    s.volatility_3y != null ? `volatility ${pct(s.volatility_3y)}` : null,
  ].filter(Boolean);
  return {
    title: s.scheme_name,
    description: `${s.scheme_name} (${s.category || s.fund_house}): NAV ₹${s.last_nav?.toFixed(2) ?? "—"} on ${date(s.last_nav_date)}. ${bits.join(", ")}. Returns, risk, rolling returns, SIP XIRR and peer ranks.`,
    alternates: { canonical: fundHref(s.scheme_code, s.scheme_name) },
  };
}

export default function FundPage({ params }: PageProps<"/funds/[id]">) {
  return (
    <Suspense fallback={<FundSkeleton />}>
      <Fund params={params} />
    </Suspense>
  );
}

const SECTIONS = [
  ["performance", "Performance"],
  ["returns", "Returns"],
  ["calendar", "Calendar"],
  ["risk", "Risk"],
  ["benchmark", "Benchmark"],
  ["rolling", "Rolling"],
  ["drawdowns", "Drawdowns"],
  ["sip", "SIP"],
  ["ranks", "Peer ranks"],
] as const;

async function Fund({ params }: { params: Promise<{ id: string }> }) {
  const code = parseFundId((await params).id);
  if (!code) notFound();
  const v = await currentVersion();
  await apiOrNotFound<Scheme>(`/v1/schemes/${code}`, undefined, v);
  return <FundBody code={code} v={v} />;
}

/** The whole page for one fund at one data version, rendered once and then served from cache. */
async function FundBody({ code, v }: { code: number; v: string }) {
  "use cache";
  cacheLife(VERSIONED);
  const res = await api<Scheme>(`/v1/schemes/${code}`, undefined, v);
  if (!res) return null;
  const s = res.data;

  return (
    <div className="space-y-6">
      <FundHeader s={s} />

      <nav aria-label="Sections" className="bleed-x sticky top-[57px] z-30 border-b border-border bg-bg max-lg:top-[94px]">
        <ul className="tabs">
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`}>
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_24rem]">
        {/* On very wide screens the sections pair up in two columns. */}
        <div className="grid min-w-0 content-start gap-6 2xl:grid-cols-2">
          <div className="min-w-0 2xl:col-span-2">
            <Suspense fallback={<CardSkeleton title="Performance" height="h-80" />}>
              <PerformanceSection s={s} v={v} />
            </Suspense>
          </div>
          <div className="min-w-0">
            <Suspense fallback={<CardSkeleton title="Trailing returns" />}>
              <ReturnsSection s={s} v={v} />
            </Suspense>
          </div>
          <div className="min-w-0">
            <Suspense fallback={<CardSkeleton title="Calendar returns" />}>
              <CalendarSection code={s.scheme_code} v={v} />
            </Suspense>
          </div>
          <div className="min-w-0">
            <Suspense fallback={<CardSkeleton title="Risk and risk-adjusted returns" />}>
              <RiskSection code={s.scheme_code} v={v} />
            </Suspense>
          </div>
          <div className="min-w-0">
            <Suspense fallback={<CardSkeleton title="Against the benchmarks" />}>
              <RelativeSection s={s} v={v} />
            </Suspense>
          </div>
          <div className="min-w-0">
            <Suspense fallback={<CardSkeleton title="Rolling returns" height="h-80" />}>
              <RollingSection code={s.scheme_code} v={v} />
            </Suspense>
          </div>
          <div className="min-w-0">
            <Suspense fallback={<CardSkeleton title="Drawdowns" height="h-72" />}>
              <DrawdownSection code={s.scheme_code} v={v} />
            </Suspense>
          </div>
          <div className="min-w-0 2xl:col-span-2">
            <Suspense fallback={<CardSkeleton title="SIP returns" />}>
              <SipSection s={s} v={v} />
            </Suspense>
          </div>
          <div className="min-w-0 2xl:col-span-2">
            <Suspense fallback={<CardSkeleton title="Peer ranks" height="h-96" />}>
              <RanksCard s={s} v={v} />
            </Suspense>
          </div>
          <div className="grid min-w-0 content-start gap-6 md:grid-cols-2 2xl:col-span-2">
            <Card title="Lumpsum calculator" subtitle="Value today of a one-time investment">
              <LumpsumCalculator code={s.scheme_code} inception={s.inception_date ?? null} asOf={s.last_nav_date} />
            </Card>
            <Suspense fallback={null}>
              <QualityCard code={s.scheme_code} v={v} />
            </Suspense>
            {s.option !== "Growth" && (
              <Suspense fallback={null}>
                <PayoutsCard s={s} v={v} />
              </Suspense>
            )}
          </div>
        </div>

        {/* A short rail of reference facts that stays in view beside the long main column, on
            screens tall enough to show all of it. */}
        <aside className="rail-sticky min-w-0 space-y-6 lg:self-start">
          <KeyFacts s={s} />
          <PlanLinks s={s} />
          <p className="text-[13px] text-muted">
            Compare this fund with others in the{" "}
            <Link href={`/compare?codes=${s.scheme_code}`} className="link">
              comparison tool
            </Link>
            .
          </p>
        </aside>
      </div>
    </div>
  );
}

function FundSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-3">
        <SkeletonBlock className="h-4 w-48" />
        <SkeletonBlock className="h-8 w-3/4" />
        <SkeletonBlock className="h-20 w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-6">
          <CardSkeleton title="Performance" height="h-80" />
          <CardSkeleton title="Trailing returns" />
        </div>
        <CardSkeleton height="h-96" />
      </div>
    </div>
  );
}

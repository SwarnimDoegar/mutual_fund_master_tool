import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { SearchBox } from "@/components/search-box";
import { DataFreshness } from "@/components/data-freshness";
import { NAV_LINKS, SITE_NAME, SITE_TAGLINE, SITE_URL } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME} — Indian mutual fund analytics`, template: `%s · ${SITE_NAME}` },
  description: SITE_TAGLINE,
  openGraph: { siteName: SITE_NAME, type: "website" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0f14" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 btn">
          Skip to content
        </a>
        <header className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur">
          <div className="page-x flex items-center gap-4 py-2.5">
            <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
              <Logo />
              <span className="hidden sm:inline">{SITE_NAME}</span>
            </Link>
            <nav aria-label="Main" className="hidden items-center gap-1 text-sm lg:flex">
              {NAV_LINKS.map((l) => (
                <Link key={l.href} href={l.href} className="rounded-md px-2.5 py-1.5 text-muted hover:bg-surface-2 hover:text-text">
                  {l.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto w-full max-w-md">
              <SearchBox />
            </div>
          </div>
          <nav aria-label="Main" className="page-x flex gap-1 overflow-x-auto pb-2 text-sm lg:hidden">
            {NAV_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="shrink-0 rounded-md px-2.5 py-1 text-muted hover:bg-surface-2 hover:text-text">
                {l.label}
              </Link>
            ))}
          </nav>
        </header>

        <main id="main" className="page-x flex-1 py-6">
          {children}
        </main>

        <footer className="border-t border-border bg-surface">
          <div className="page-x grid gap-3 py-6 text-xs text-muted sm:grid-cols-2">
            <div className="space-y-1">
              <p>
                NAV data from AMFI via{" "}
                <a className="link" href="https://www.mfapi.in/" rel="noopener">
                  mfapi.in
                </a>
                . Metrics are computed from published NAVs only; see{" "}
                <Link className="link" href="/learn">
                  how every metric is computed
                </Link>
                .
              </p>
              <p>Past performance does not guarantee future returns. Nothing here is investment advice.</p>
            </div>
            <div className="space-y-1 sm:text-right">
              <Suspense fallback={<p>&nbsp;</p>}>
                <DataFreshness />
              </Suspense>
              <p>
                Charts: TradingView Lightweight Charts™ Copyright © 2025{" "}
                <a className="link" href="https://www.tradingview.com/" rel="noopener">
                  TradingView, Inc.
                </a>
              </p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}

function Logo() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden className="text-brand">
      <rect width="24" height="24" rx="6" fill="currentColor" />
      <path d="M5 16l4-5 3 3 6-7" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

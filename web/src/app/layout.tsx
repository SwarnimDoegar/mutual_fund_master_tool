import type { Metadata, Viewport } from "next";
import { Source_Sans_3 } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { SearchBox } from "@/components/search-box";
import { DataFreshness } from "@/components/data-freshness";
import { NAV_LINKS, SITE_NAME, SITE_TAGLINE, SITE_URL } from "@/lib/site";
import "./globals.css";

const sourceSans = Source_Sans_3({ variable: "--font-source-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME} — Indian mutual fund analytics`, template: `%s · ${SITE_NAME}` },
  description: SITE_TAGLINE,
  openGraph: { siteName: SITE_NAME, type: "website" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0f172a" },
    { media: "(prefers-color-scheme: dark)", color: "#090d13" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" className={`${sourceSans.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 btn">
          Skip to content
        </a>
        <header className="sticky top-0 z-40 border-b border-shell-border bg-shell text-shell-text">
          <div className="page-x flex h-14 items-center gap-6">
            <Link href="/" className="flex shrink-0 items-center gap-2 text-[17px] font-bold text-white">
              <Logo />
              <span className="hidden sm:inline">{SITE_NAME}</span>
            </Link>
            <nav aria-label="Main" className="hidden h-full items-stretch gap-5 text-sm lg:flex">
              {NAV_LINKS.map((l) => (
                <Link key={l.href} href={l.href} className="flex items-center border-y-2 border-transparent font-semibold text-shell-muted hover:border-b-shell-muted hover:text-white">
                  {l.label}
                </Link>
              ))}
            </nav>
            <div className="shell-search ml-auto w-full max-w-md">
              <SearchBox />
            </div>
          </div>
          <nav aria-label="Main" className="page-x flex gap-4 overflow-x-auto border-t border-shell-border text-[13px] lg:hidden">
            {NAV_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="shrink-0 py-2 font-semibold text-shell-muted hover:text-white">
                {l.label}
              </Link>
            ))}
          </nav>
        </header>

        <main id="main" className="page-x flex-1 py-6">
          {children}
        </main>

        <footer className="border-t border-border bg-surface">
          <div className="page-x grid gap-3 py-5 text-xs text-muted sm:grid-cols-2">
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

/** A lens over a rising line, in the app bar's colours. */
function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
      <circle cx="9.5" cy="9.5" r="7.25" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M14.8 14.8 20 20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M5.5 12l2.5-3 2 1.8 3-4.3" fill="none" stroke="#8fb0ff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

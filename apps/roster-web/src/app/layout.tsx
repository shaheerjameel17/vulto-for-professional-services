import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { AppearanceProvider } from "./appearance";
import "./globals.css";

/*
 * FDN-11. Two faces, two jobs.
 *
 * Inter carries display, interface and body; Geist Mono carries the figures.
 *
 * Inter is loaded as a variable font — no `weight` array, which is what makes
 * next/font serve the variable file rather than static cuts. The token scale
 * asks for 560 and 640, weights no static family provides, and a static build
 * would silently round them to 500 and 600.
 *
 * Self-hosted via next/font per VPS-A001: no external font CDN, both for
 * latency and because a font request is a third-party beacon on every page of
 * an HR product.
 */

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Also variable, as of FDN-15: `mono-lg` now asks for 600 so the bench figure
// is heavier than the assignment label beside it, and the static pair of cuts
// did not include it.
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Vulto Roster",
  description: "Prototype",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      data-theme="light"
      data-density="comfortable"
      data-cat-palette="current"
      className={`${inter.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <AppearanceProvider>{children}</AppearanceProvider>
      </body>
    </html>
  );
}

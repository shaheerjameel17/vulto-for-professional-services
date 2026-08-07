import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AppearanceProvider } from "./appearance";
import "./globals.css";

/*
 * FDN-29. One product face, with two numeric modes.
 *
 * Inter carries display, interface, body and figures. Product figures use its
 * tabular OpenType numerals so columns still align without inheriting a
 * developer-tool voice from a separate monospace family.
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
      className={inter.variable}
      suppressHydrationWarning
    >
      <body>
        <AppearanceProvider>{children}</AppearanceProvider>
      </body>
    </html>
  );
}

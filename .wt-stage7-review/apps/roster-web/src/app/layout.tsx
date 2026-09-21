import type { Metadata } from "next";
import localFont from "next/font/local";
import { AppearanceProvider } from "./appearance";
import "./globals.css";

/*
 * FDN-29. One product face, with two numeric modes.
 *
 * Inter carries display, interface, body and figures. Product figures use its
 * tabular OpenType numerals so columns still align without inheriting a
 * developer-tool voice from a separate monospace family.
 *
 * Inter is loaded as a variable font — the `weight: "100 900"` range is what
 * makes next/font serve the variable file rather than static cuts. The token
 * scale asks for 560 and 640, weights no static family provides, and a static
 * build would silently round them to 500 and 600.
 *
 * Self-hosted from a file committed to this repository
 * (`fonts/inter-latin-wght-normal.woff2`, the Latin variable-weight cut of
 * `@fontsource-variable/inter@5.3.0`, OFL-1.1 — see `fonts/README.md`). Per
 * VPS-A001: no external font CDN — and, unlike `next/font/google`, no font
 * fetch at build time either, so a production build is hermetic. Both matter:
 * latency, and the fact that a font request is a third-party beacon on every
 * page of an HR product.
 */

const inter = localFont({
  src: "./fonts/inter-latin-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Vulto Roster",
  description: "Prototype",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
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

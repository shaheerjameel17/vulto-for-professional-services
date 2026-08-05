import type { Metadata } from "next";
import { Geist_Mono, Manrope, Plus_Jakarta_Sans } from "next/font/google";
import { AppearanceProvider } from "./appearance";
import "./globals.css";

/*
 * Three faces, three jobs, no overlap. VPS-D001.
 *
 * Self-hosted via next/font per VPS-A001: no external font CDN, both for
 * latency and because a font request is a third-party beacon on every page of
 * an HR product. Only the weights VPS-D001 names are loaded.
 */

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-manrope",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
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
      data-density="compact"
      className={`${jakarta.variable} ${manrope.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <AppearanceProvider>{children}</AppearanceProvider>
      </body>
    </html>
  );
}

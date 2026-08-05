import type { ReactNode } from "react";
import { cx } from "./cx";

/*
 * VPS-D004. Three regions, fixed for the life of the product.
 *
 *   ┌────────────┬──────────────────────────────┬─────────────┐
 *   │            │  Page header                 │             │
 *   │  Sidebar   ├──────────────────────────────┤   Panel     │
 *   │   240px    │  Content                     │   360px     │
 *   │  ────────  │                              │             │
 *   │  Status    │                              │             │
 *   └────────────┴──────────────────────────────┴─────────────┘
 *
 * The shell is identical across applications. Switching from Roster to
 * Projects changes what is in the content region and nothing else.
 */

export type AppShellProps = {
  sidebar: ReactNode;
  panel?: ReactNode;
  children: ReactNode;
};

export function AppShell({ sidebar, panel, children }: AppShellProps) {
  return (
    <div className="relative flex h-screen overflow-hidden bg-bg-canvas">
      {sidebar}
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      {/*
       * VPS-D003's responsive rule: at 1280–1535px the Panel overlays the right
       * edge of content; at 1536px and above it opens alongside without
       * displacing it. Displacing at the design center costs the Bench Forecast
       * roughly half its width, which on a screen whose horizontal space is
       * time is not a cosmetic difference.
       */}
      {panel ? (
        <div className="absolute inset-y-0 right-0 z-30 flex 2xl:static 2xl:z-auto">
          {panel}
        </div>
      ) : null}
    </div>
  );
}

/*
 * Content is fluid with a 1440px maximum and space-6 horizontal padding.
 *
 * The Bench Forecast and other timeline surfaces are exempt from the maximum
 * and run to the full viewport, because horizontal space on those screens is
 * time, and time is the thing the user came for. That is `fullBleed`.
 */
export type ContentProps = {
  fullBleed?: boolean;
  children: ReactNode;
  className?: string;
};

export function Content({ fullBleed, children, className }: ContentProps) {
  return (
    <main
      className={cx(
        "min-h-0 flex-1",
        fullBleed
          ? "flex flex-col overflow-hidden"
          : "overflow-y-auto px-6 pb-8",
        className,
      )}
    >
      {fullBleed ? children : (
        <div className="mx-auto w-full max-w-content">{children}</div>
      )}
    </main>
  );
}

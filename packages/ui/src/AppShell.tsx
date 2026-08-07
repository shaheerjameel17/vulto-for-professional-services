import type { ReactNode } from "react";
import { cx } from "./cx";

/*
 * VPS-D004. Three regions, fixed for the life of the product.
 *
 *   ┌────────────┬──────────────────────────────┬─────────────┐
 *   │            │  Page header                 │             │
 *   │  Sidebar   ├──────────────────────────────┤   Panel     │
 *   │   216px    │  Content                     │   360px     │
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
    // FDN-16: one continuous background across the window. The sidebar has no
    // surface of its own and sits directly on this canvas.
    <div className="flex h-screen overflow-hidden bg-bg-canvas">
      {sidebar}
      {/*
       * The workspace, as an inset panel: rounded corners, a hairline border,
       * margin on all four sides. The page header lives inside it, so the whole
       * of what an application shows sits on one surface and the chrome around
       * it is canvas.
       */}
      {/* FDN-19: `radius-xl`. The concentric rule in VPS-D001 derives every
        * nested radius from this one. */}
      <div className="relative m-3 flex min-w-0 flex-1 rounded-xl border border-border-default bg-bg-subtle">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl">
          {children}
        </div>
        {/*
         * FDN-19: an inset within the inset. The Panel sits space-1 inside the
         * workspace on all four sides and carries `radius-lg` — 12px minus the
         * 4px gap — so it is concentric with the panel containing it rather than
         * running to the window edge.
         *
         * VPS-D003's responsive rule: at 1280–1535px the Panel overlays the
         * right edge of content; at 1536px and above it opens alongside without
         * displacing it. Displacing at the design center costs the Bench
         * Forecast roughly half its width, which on a screen whose horizontal
         * space is time is not a cosmetic difference.
         *
         * `absolute` is what makes that true below 1536px: the content column
         * keeps its full width and the Panel is drawn over it.
         */}
        {panel ? (
          <div className="absolute inset-y-1 right-1 z-50 flex overflow-hidden rounded-lg elevation-overlay 2xl:static 2xl:my-1 2xl:mr-1 2xl:z-auto 2xl:shadow-none">
            {panel}
          </div>
        ) : null}
      </div>
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

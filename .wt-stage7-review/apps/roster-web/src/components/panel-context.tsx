"use client";

import { createContext, useContext, type ReactNode } from "react";

/*
 * The Panel is owned by the shell, per VPS-D004: its open state persists per
 * screen for the session, so a screen hands it content rather than rendering
 * its own right-hand surface.
 */

type PanelValue = {
  panel: ReactNode;
  setPanel: (panel: ReactNode) => void;
};

export const PanelContext = createContext<PanelValue | null>(null);

export function usePanel(): PanelValue {
  const value = useContext(PanelContext);
  if (!value) throw new Error("usePanel must be used inside the Shell");
  return value;
}

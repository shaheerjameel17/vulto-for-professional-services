"use client";

import { useEffect, useRef } from "react";

/*
 * The keyboard model from VPS-D003, which is suite-wide by design: a person
 * who learns `J`/`K` in Roster expects it in Projects, and an application that
 * rebinds it has broken something more valuable than whatever it gained.
 *
 * Two rules from VPS-D003 are enforced here rather than in each screen:
 *
 *  - Shortcuts never fire while a text input has focus, except `Escape` and
 *    Cmd-modified combinations.
 *  - Sequential `G` navigation is used rather than modifier combinations,
 *    because the destinations are memorable by initial and the shortcuts
 *    remain available without conflicting with browser and OS bindings.
 */

/** How long a `G` prefix stays armed before it is forgotten. */
const SEQUENCE_WINDOW_MS = 1200;

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export type ShortcutMap = {
  /** Single keys, e.g. `j`, `k`, `1`, `t`. Suppressed inside text entry. */
  keys?: Record<string, () => void>;
  /** Cmd/Ctrl combinations, e.g. `k`, `\\`, `Enter`. Always active. */
  chords?: Record<string, () => void>;
  /** Sequences after a `g` prefix, e.g. `b` for Bench Forecast. */
  goto?: Record<string, () => void>;
  /** Dismiss the topmost layer. Always active, per VPS-D003. */
  onEscape?: () => void;
  enabled?: boolean;
};

export function useShortcuts(map: ShortcutMap): void {
  // The handler reads the latest map without re-binding the listener, so a
  // parent re-render never drops a keystroke mid-sequence.
  const latest = useRef(map);
  latest.current = map;

  const pendingGoto = useRef<number | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const current = latest.current;
      if (current.enabled === false) return;

      const inText = isTextEntry(event.target);
      const modified = event.metaKey || event.ctrlKey;

      if (event.key === "Escape") {
        pendingGoto.current = null;
        if (current.onEscape) {
          event.preventDefault();
          current.onEscape();
        }
        return;
      }

      if (modified) {
        if (event.altKey) return;
        const handler = current.chords?.[event.key.toLowerCase()];
        if (handler) {
          event.preventDefault();
          handler();
        }
        return;
      }

      // Everything below is unmodified, so it must not fire in a text field.
      if (inText || event.altKey) return;

      const key = event.key.toLowerCase();
      const armed =
        pendingGoto.current !== null &&
        Date.now() - pendingGoto.current < SEQUENCE_WINDOW_MS;

      if (armed) {
        pendingGoto.current = null;
        const handler = current.goto?.[key];
        if (handler) {
          event.preventDefault();
          handler();
          return;
        }
        // A `g` followed by an unbound key does nothing, rather than falling
        // through to that key's own shortcut.
        return;
      }

      if (key === "g" && current.goto) {
        pendingGoto.current = Date.now();
        return;
      }

      const handler = current.keys?.[key];
      if (handler) {
        event.preventDefault();
        handler();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

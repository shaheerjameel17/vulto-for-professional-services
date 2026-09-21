"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  CurrencySelect,
  DatePicker,
  Input,
  PhoneInput,
  Text,
  currencyLabel,
  cx,
} from "@vulto/ui";

/*
 * FDN-24. VRS-F002's keyboard table assigns `E` to open an edit and
 * `Escape` to discard one — both presuppose a read state, which
 * contradicted the document's own layout sentence until that sentence was
 * corrected. This is the read state.
 *
 * A field renders as plain text, with no *visible* border. `E` while it
 * holds focus, or a click, opens it as a real Input. Blur or `Cmd+Enter`
 * commits; `Escape` discards and reverts to the value it held before the
 * edit opened. There is no save button at any point in the cycle.
 *
 * FDN-28 supersedes FDN-24's borderless paint after the rendered profile
 * proved too visually scattered. The interaction stays edit-on-demand, but
 * every fact now sits on a restrained field surface. Editable paint changes
 * on hover/focus; read-only facts remain contained without looking disabled.
 *
 * FDN-26. The read box is not actually borderless — it carries the same
 * width transparent border and padding as the Input it becomes, so opening
 * a field for edit changes paint only, never layout. Zero-height/zero-box
 * was never the requirement; zero-*visible* border was.
 */

export type EditableFieldProps = {
  label: string;
  value: string;
  onCommit?: (value: string) => void;
  type?: "text" | "email" | "number" | "date" | "phone" | "currency";
  prefix?: ReactNode;
  suffix?: ReactNode;
  helperText?: string;
  /** No read/edit cycle at all — a fact stated, never entered. */
  readOnly?: boolean;
  placeholder?: string;
  step?: number;
  min?: number;
  max?: number;
};

export function EditableField({
  label,
  value,
  onCommit,
  type = "text",
  prefix,
  suffix,
  helperText,
  readOnly = false,
  placeholder = "—",
  step = 1,
  min,
  max,
}: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      const input = inputRef.current;
      input?.focus({ preventScroll: true });
    }
  }, [editing]);

  function open() {
    if (readOnly) return;
    setDraft(value);
    setEditing(true);
  }

  function commit(next = draft) {
    onCommit?.(next);
    setEditing(false);
  }

  function discard() {
    setDraft(value);
    setEditing(false);
  }

  function steppedValue(source: string, direction: -1 | 1) {
    const current = Number(source);
    const base = Number.isFinite(current) ? current : 0;
    let next = base + direction * step;
    if (min !== undefined) next = Math.max(next, min);
    if (max !== undefined) next = Math.min(next, max);
    const decimals = String(step).split(".")[1]?.length ?? 0;
    return String(Number(next.toFixed(decimals)));
  }

  function stepReadValue(direction: -1 | 1) {
    if (readOnly || type !== "number") return;
    onCommit?.(steppedValue(value, direction));
  }

  if (editing) {
    if (type === "date") {
      return (
        <DatePicker
          label={label}
          value={draft}
          onChange={setDraft}
          onCommit={commit}
          onCancel={discard}
          inputRef={inputRef}
          helperText={helperText}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
        />
      );
    }

    if (type === "phone") {
      return (
        <PhoneInput
          label={label}
          value={draft}
          onChange={setDraft}
          onCommit={() => commit()}
          onCancel={discard}
          inputRef={inputRef}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
        />
      );
    }

    if (type === "currency") {
      return (
        <CurrencySelect
          label={label}
          value={draft}
          onChange={(next) => {
            setDraft(next);
            commit(next);
          }}
        />
      );
    }

    return (
      <Input
        ref={inputRef}
        label={label}
        type={type}
        value={draft}
        prefix={prefix}
        suffix={suffix}
        helperText={helperText}
        step={step}
        min={min}
        max={max}
        onStepValue={setDraft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit()}
        onKeyDown={(e) => {
          if (type === "number" && e.key === "ArrowUp") {
            e.preventDefault();
            setDraft(steppedValue(draft, 1));
          } else if (type === "number" && e.key === "ArrowDown") {
            e.preventDefault();
            setDraft(steppedValue(draft, -1));
          } else if (e.key === "Escape") {
            e.preventDefault();
            discard();
          } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
    );
  }

  const fieldClass = cx(
    "h-control rounded-md border border-border-default bg-bg-surface",
    "motion-fast transition-colors",
    !readOnly && "hover:border-border-strong hover:bg-bg-hover",
    !readOnly && "focus-visible:outline focus-visible:outline-2",
    !readOnly && "focus-visible:outline-border-focus focus-visible:outline-offset-2",
  );

  const valueNode = (
    <>
      <Text
        variant={type === "number" ? "numeric" : "body"}
        className="truncate text-text-primary"
      >
        {type === "currency" ? currencyLabel(value) : value || placeholder}
      </Text>
      {suffix !== undefined ? (
        <Text variant="small" className="shrink-0 pl-2 text-text-tertiary">
          {suffix}
        </Text>
      ) : null}
    </>
  );

  return (
    <div className="flex flex-col gap-1">
      <Text variant="label" className="text-text-secondary">
        {label}
      </Text>
      {readOnly ? (
        <div className={cx("flex items-center justify-between px-3", fieldClass)}>
          {valueNode}
        </div>
      ) : type === "number" ? (
        <div
          className={cx(
            "flex items-center focus-within:outline focus-within:outline-2",
            "focus-within:outline-border-focus focus-within:outline-offset-2",
            fieldClass,
          )}
        >
          <button
            type="button"
            onClick={open}
            onKeyDown={(event) => {
              if (event.key === "e" || event.key === "E" || event.key === "Enter") {
                event.preventDefault();
                open();
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                stepReadValue(1);
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                stepReadValue(-1);
              }
            }}
            className="flex min-w-0 flex-1 cursor-text items-center justify-between self-stretch px-3 text-left outline-none"
          >
            {valueNode}
          </button>
          <span className="flex h-full w-button-sm shrink-0 flex-col border-l border-border-default">
            <button
              type="button"
              aria-label={`Increase ${label}`}
              onClick={() => stepReadValue(1)}
              className="flex min-h-0 flex-1 items-center justify-center text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
            >
              <ChevronUp className="size-3" />
            </button>
            <button
              type="button"
              aria-label={`Decrease ${label}`}
              onClick={() => stepReadValue(-1)}
              className="flex min-h-0 flex-1 items-center justify-center border-t border-border-default text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
            >
              <ChevronDown className="size-3" />
            </button>
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={open}
          onKeyDown={(event) => {
            if (event.key === "e" || event.key === "E" || event.key === "Enter") {
              event.preventDefault();
              open();
            }
          }}
          className={cx(
            "flex w-full cursor-text items-center justify-between px-3 text-left",
            fieldClass,
          )}
        >
          {valueNode}
        </button>
      )}
      {helperText ? (
        <Text variant="small" className="text-text-secondary">
          {helperText}
        </Text>
      ) : null}
    </div>
  );
}

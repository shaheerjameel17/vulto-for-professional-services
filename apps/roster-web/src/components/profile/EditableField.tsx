"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Input, Text } from "@vulto/ui";

/*
 * FDN-24. VRS-F002's keyboard table assigns `E` to open an edit and
 * `Escape` to discard one — both presuppose a read state, which
 * contradicted the document's own layout sentence until that sentence was
 * corrected. This is the read state.
 *
 * A field renders as plain text, no border, no box. `E` while it holds
 * focus, or a click, opens it as a real Input. Blur or `Cmd+Enter` commits;
 * `Escape` discards and reverts to the value it held before the edit
 * opened. There is no save button at any point in the cycle.
 *
 * The container that CAN be clicked/E'd carries no visual difference from
 * one that can't until the moment it's focused — the read state is
 * deliberately quiet, per VRS-F002's correction, so thirty of these in a
 * row read as a record rather than a form.
 */

export type EditableFieldProps = {
  label: string;
  value: string;
  onCommit?: (value: string) => void;
  type?: "text" | "email" | "number" | "date";
  prefix?: ReactNode;
  suffix?: ReactNode;
  helperText?: string;
  /** No read/edit cycle at all — a fact stated, never entered. */
  readOnly?: boolean;
  placeholder?: string;
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
}: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function open() {
    if (readOnly) return;
    setDraft(value);
    setEditing(true);
  }

  function commit() {
    onCommit?.(draft);
    setEditing(false);
  }

  function discard() {
    setDraft(value);
    setEditing(false);
  }

  if (editing) {
    return (
      <Input
        ref={inputRef}
        label={label}
        type={type}
        value={draft}
        prefix={prefix}
        suffix={suffix}
        helperText={helperText}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
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

  return (
    <div className="flex flex-col gap-1">
      <Text variant="label" className="text-text-secondary">
        {label}
      </Text>
      <div
        role={readOnly ? undefined : "button"}
        tabIndex={readOnly ? undefined : 0}
        onClick={open}
        onKeyDown={(e) => {
          if (readOnly) return;
          if (e.key === "e" || e.key === "E" || e.key === "Enter") {
            e.preventDefault();
            open();
          }
        }}
        className={
          readOnly
            ? "flex h-control items-center justify-between rounded-md px-3 -mx-3"
            : "flex h-control items-center justify-between rounded-md px-3 -mx-3 cursor-text motion-fast transition-colors hover:bg-bg-hover"
        }
      >
        <Text variant="body" className="truncate text-text-primary">
          {value || placeholder}
        </Text>
        {suffix !== undefined ? (
          <Text variant="small" className="shrink-0 pl-2 text-text-tertiary">
            {suffix}
          </Text>
        ) : null}
      </div>
      {helperText ? (
        <Text variant="small" className="text-text-secondary">
          {helperText}
        </Text>
      ) : null}
    </div>
  );
}

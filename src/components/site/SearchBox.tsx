"use client";

import { useEffect, useRef, useState } from "react";
import { themeA } from "@/components/parallel/theme";

/**
 * SearchBox, the shared client-side search input used in both the SiteHeader
 * (compact "header" variant on internal pages) and the landing hero ("hero"
 * variant, larger and more prominent).
 *
 * Behaviors that justify the client boundary:
 *   1. Keyboard shortcut: '/' (when not already typing) and Cmd/Ctrl+K
 *      focus and select the input from anywhere on the page. Standard for
 *      modern dev tools (GitHub, Linear). Matters for repeat visitors.
 *   2. Inline clear button (X) appears when the input has any value, so
 *      users don't have to select-all + delete to retry a search.
 *   3. Controlled value so `defaultValue` (used when /go bounces unparseable
 *      input back to the landing) actually pre-fills the new search.
 *
 * Submission is plain HTML form GET to /go, which is the smart-routing
 * server endpoint. No JS-side fetch, no client-router push, no JS error
 * handling. Search keeps working if our client bundle is broken.
 */

interface Props {
  variant: "header" | "hero";
  /** Pre-fill the input. Used on the landing when /go bounces with q_error. */
  defaultValue?: string;
  /** Focus the input on mount. Used on the landing hero (primary CTA). */
  autoFocus?: boolean;
}

export default function SearchBox({
  variant,
  defaultValue = "",
  autoFocus = false,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue);

  // Keyboard shortcut: '/' or Cmd/Ctrl+K focuses the search.
  // '/' is suppressed while the user is typing in another input or
  // contenteditable so it doesn't steal focus mid-edit. Cmd+K is always
  // active because it's an explicit modifier and overrides anyway.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      const slash = e.key === "/" && !isTyping;
      const cmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";

      if (slash || cmdK) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (variant === "header") {
    return (
      <form
        action="/go"
        role="search"
        style={{
          display: "flex",
          alignItems: "stretch",
          width: "100%",
          maxWidth: 420,
        }}
      >
        <div style={{ position: "relative", flex: 1, display: "flex" }}>
          <input
            ref={inputRef}
            type="text"
            name="q"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label="Search blocks, contracts, or transactions"
            placeholder="block # · 0x address · tx hash · /"
            autoComplete="off"
            spellCheck={false}
            style={{
              flex: 1,
              minWidth: 0,
              background: themeA.panel,
              border: `1px solid ${themeA.border}`,
              borderRight: "none",
              borderTopLeftRadius: themeA.radius,
              borderBottomLeftRadius: themeA.radius,
              padding: value ? "8px 28px 8px 12px" : "8px 12px",
              color: themeA.text,
              fontFamily: themeA.mono,
              fontSize: 12,
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          {value && <ClearButton onClear={() => clear(setValue, inputRef)} />}
        </div>
        <SubmitButton compact>{"→"}</SubmitButton>
      </form>
    );
  }

  // Hero variant
  return (
    <form
      action="/go"
      role="search"
      style={{
        display: "flex",
        gap: 10,
        alignItems: "stretch",
        marginTop: defaultValue ? 12 : 32,
        maxWidth: 640,
      }}
    >
      <div style={{ position: "relative", flex: 1, display: "flex" }}>
        <input
          ref={inputRef}
          type="text"
          name="q"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus={autoFocus}
          aria-label="Search blocks, contracts, or transactions"
          placeholder="0x… contract address, paste a block #, or type 'latest'"
          autoComplete="off"
          spellCheck={false}
          style={{
            flex: 1,
            minWidth: 0,
            background: themeA.panel,
            border: `1px solid ${themeA.border}`,
            borderRadius: themeA.radius,
            padding: value ? "14px 36px 14px 16px" : "14px 16px",
            color: themeA.text,
            fontFamily: themeA.mono,
            fontSize: 13,
            outline: "none",
            boxSizing: "border-box",
          }}
        />
        {value && <ClearButton onClear={() => clear(setValue, inputRef)} large />}
      </div>
      <SubmitButton>Find bottlenecks →</SubmitButton>
    </form>
  );
}

function clear(
  setValue: (v: string) => void,
  inputRef: React.RefObject<HTMLInputElement | null>,
) {
  setValue("");
  inputRef.current?.focus();
}

function ClearButton({
  onClear,
  large = false,
}: {
  onClear: () => void;
  large?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClear}
      aria-label="Clear search"
      style={{
        position: "absolute",
        right: large ? 10 : 6,
        top: "50%",
        transform: "translateY(-50%)",
        background: "transparent",
        border: "none",
        color: themeA.subtle,
        cursor: "pointer",
        fontSize: large ? 14 : 12,
        lineHeight: 1,
        padding: "4px 6px",
        borderRadius: themeA.radius,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = themeA.text)}
      onMouseLeave={(e) => (e.currentTarget.style.color = themeA.subtle)}
    >
      ✕
    </button>
  );
}

function SubmitButton({
  children,
  compact = false,
}: {
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <button
      type="submit"
      aria-label="Search"
      style={{
        background: themeA.accent,
        color: themeA.onAccent,
        border: "none",
        borderTopRightRadius: themeA.radius,
        borderBottomRightRadius: themeA.radius,
        borderTopLeftRadius: compact ? 0 : themeA.radius,
        borderBottomLeftRadius: compact ? 0 : themeA.radius,
        padding: compact ? "0 14px" : "0 22px",
        fontSize: 13,
        fontFamily: themeA.sans,
        fontWeight: 500,
        cursor: "pointer",
        letterSpacing: ".01em",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

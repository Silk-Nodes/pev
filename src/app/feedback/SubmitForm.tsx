"use client";

/**
 * SubmitForm, client-side form for submitting a new feature request.
 *
 * Lives inside the /feedback page, expandable from a small CTA so it
 * doesn't dominate the view until someone wants to submit.
 *
 * Validation mirrors the server (5-120 chars title, ≤2000 chars desc)
 * so users see issues before round-tripping. Server is the source of
 * truth though; if the client check disagrees the server's error
 * message takes over.
 *
 * On success we navigate to /feedback (refresh) so the new request
 * shows up. We could optimistically prepend it to the list but the
 * server-rendered list keeps the code simpler and the cost is one
 * extra round trip.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { themeA } from "@/components/parallel/theme";

const TITLE_MIN = 5;
const TITLE_MAX = 120;
const DESC_MAX = 2000;

export default function SubmitForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setTitle("");
    setDescription("");
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (t.length < TITLE_MIN || t.length > TITLE_MAX) {
      setError(`title must be ${TITLE_MIN} to ${TITLE_MAX} characters`);
      return;
    }
    if (description.length > DESC_MAX) {
      setError(`description must be ${DESC_MAX} characters or fewer`);
      return;
    }
    setError(null);

    startTransition(async () => {
      try {
        const res = await fetch("/api/v1/feedback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: t,
            description: description.trim() || null,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setError(body.error ?? "couldn't submit, try again");
          return;
        }
        reset();
        setOpen(false);
        router.refresh();
      } catch {
        setError("network error, try again");
      }
    });
  }

  if (!open) {
    return (
      <div style={{ marginBottom: 32 }}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            background: themeA.accent,
            color: themeA.onAccent,
            border: "none",
            borderRadius: themeA.radius,
            padding: "10px 18px",
            fontSize: 13,
            fontFamily: themeA.sans,
            fontWeight: 500,
            cursor: "pointer",
            letterSpacing: ".01em",
          }}
        >
          Suggest a feature →
        </button>
      </div>
    );
  }

  const titleLen = title.trim().length;
  const titleOk = titleLen >= TITLE_MIN && titleLen <= TITLE_MAX;

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        marginBottom: 32,
        padding: 20,
        background: themeA.panel,
        border: `1px solid ${themeA.border}`,
        borderRadius: themeA.radius,
      }}
    >
      <div className="pev-eyebrow" style={{ marginBottom: 12 }}>
        New request
      </div>

      <label
        htmlFor="feedback-title"
        style={{
          display: "block",
          fontSize: 12,
          color: themeA.muted,
          marginBottom: 6,
          fontFamily: themeA.mono,
        }}
      >
        Title
      </label>
      <input
        id="feedback-title"
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What should pev build?"
        maxLength={TITLE_MAX + 20}
        autoFocus
        style={{
          width: "100%",
          background: themeA.bg,
          border: `1px solid ${themeA.border}`,
          borderRadius: themeA.radius,
          padding: "10px 12px",
          color: themeA.text,
          fontFamily: themeA.sans,
          fontSize: 14,
          outline: "none",
          boxSizing: "border-box",
          marginBottom: 4,
        }}
      />
      <div
        style={{
          fontSize: 10,
          color:
            titleLen > TITLE_MAX
              ? themeA.status.sourceText
              : titleOk
                ? themeA.muted
                : themeA.subtle,
          fontFamily: themeA.mono,
          marginBottom: 14,
        }}
      >
        {`${titleLen} / ${TITLE_MAX}`}
      </div>

      <label
        htmlFor="feedback-desc"
        style={{
          display: "block",
          fontSize: 12,
          color: themeA.muted,
          marginBottom: 6,
          fontFamily: themeA.mono,
        }}
      >
        Description (optional)
      </label>
      <textarea
        id="feedback-desc"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Why does this matter? What does it look like in practice?"
        maxLength={DESC_MAX + 100}
        rows={4}
        style={{
          width: "100%",
          background: themeA.bg,
          border: `1px solid ${themeA.border}`,
          borderRadius: themeA.radius,
          padding: "10px 12px",
          color: themeA.text,
          fontFamily: themeA.sans,
          fontSize: 13,
          outline: "none",
          boxSizing: "border-box",
          resize: "vertical",
          lineHeight: 1.5,
        }}
      />
      <div
        style={{
          fontSize: 10,
          color: description.length > DESC_MAX ? themeA.status.sourceText : themeA.subtle,
          fontFamily: themeA.mono,
          marginBottom: 16,
        }}
      >
        {`${description.length} / ${DESC_MAX}`}
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: "8px 12px",
            background: themeA.hintBg,
            border: `1px solid ${themeA.status.source}`,
            borderRadius: themeA.radius,
            color: themeA.text,
            fontSize: 12,
            marginBottom: 14,
            fontFamily: themeA.mono,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button
          type="submit"
          disabled={!titleOk || pending}
          style={{
            background: titleOk && !pending ? themeA.accent : themeA.border,
            color: titleOk && !pending ? themeA.onAccent : themeA.subtle,
            border: "none",
            borderRadius: themeA.radius,
            padding: "10px 18px",
            fontSize: 13,
            fontFamily: themeA.sans,
            fontWeight: 500,
            cursor: titleOk && !pending ? "pointer" : "default",
            letterSpacing: ".01em",
          }}
        >
          {pending ? "Submitting…" : "Submit request"}
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          disabled={pending}
          style={{
            background: "transparent",
            border: "none",
            color: themeA.muted,
            fontSize: 13,
            fontFamily: themeA.sans,
            cursor: pending ? "default" : "pointer",
            padding: "10px 4px",
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

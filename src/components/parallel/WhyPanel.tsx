"use client";

/**
 * WhyPanel — explains, in plain language, why the selected tx is in the
 * wave it's in. Shows:
 *   - status badge (parallel / delayed / blocks others)
 *   - inbound conflicts: which earlier txs forced this one to wait, and on
 *     which storage slots
 *   - outbound conflicts: which later txs THIS tx blocked, and on which slots
 *
 * If no tx is selected, shows a hint instead.
 *
 * Note: the original variation-a's WhyPanel had a hand-tuned "Suggestion"
 * paragraph based on contract name (Pool, Comptroller, etc). We don't have
 * decoded contract names yet — until 4byte/Sourcify wiring lands, the
 * suggestion is omitted rather than faked.
 */

import { usePEV } from "./PEVContext";
import { themeA } from "./theme";
import type { ConflictKind } from "@/lib/parallel-probe";

const KIND_LABEL: Record<ConflictKind, string> = {
  "write-write": "write/write",
  "read-write": "read/write",
  mixed: "mixed",
};

export default function WhyPanel() {
  const { data, selected, txById } = usePEV();
  const { conflicts } = data;
  const tx = selected ? txById.get(selected) : null;

  if (!tx) {
    return (
      <div
        style={{
          border: `1px dashed ${themeA.border}`,
          borderRadius: themeA.radius,
          padding: 16,
          fontSize: 12,
          color: themeA.muted,
          fontFamily: themeA.sans,
        }}
      >
        <div className="pev-eyebrow" style={{ marginBottom: 6 }}>
          What's blocking what?
        </div>
        Click any transaction in the timeline or graph to see which storage
        slots forced it to wait — and which later transactions it blocked.
      </div>
    );
  }

  const inbound = conflicts.filter((c) => c.toId === tx.id);
  const outbound = conflicts.filter((c) => c.fromId === tx.id);

  const statusBadge =
    tx.status === "source"
      ? { label: `Blocks ${tx.outboundConflicts} later tx${tx.outboundConflicts === 1 ? "" : "s"}`, color: themeA.status.source }
      : tx.status === "delayed"
        ? { label: `Delayed · waits on wave ${tx.wave}`, color: themeA.status.delayed }
        : { label: "Parallel · executed independently", color: themeA.status.clean };

  return (
    <div
      style={{
        border: `1px solid ${themeA.border}`,
        borderRadius: themeA.radius,
        background: themeA.cardBg,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 16px",
          borderBottom: `1px solid ${themeA.border}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontFamily: themeA.mono, fontSize: 11, color: themeA.text }}>
            {tx.id}
          </span>
          <span style={{ fontFamily: themeA.mono, fontSize: 10, color: themeA.muted }}>
            {tx.label}
          </span>
        </div>
        <span style={{ fontFamily: themeA.mono, fontSize: 10, color: statusBadge.color }}>
          ● {statusBadge.label}
        </span>
      </div>

      <div style={{ padding: 16, fontFamily: themeA.sans, fontSize: 12, color: themeA.text }}>
        <div style={{ color: themeA.muted, marginBottom: 8 }}>
          <span style={{ fontFamily: themeA.mono }}>{tx.contractLabel}</span>
          <span style={{ color: themeA.subtle }}> · pos </span>
          <span style={{ fontFamily: themeA.mono, color: themeA.text }}>{tx.position}</span>
          <span style={{ color: themeA.subtle }}> · wave </span>
          <span style={{ fontFamily: themeA.mono, color: themeA.text }}>{tx.wave}</span>
          <span style={{ color: themeA.subtle }}> · r/w </span>
          <span style={{ fontFamily: themeA.mono, color: themeA.text }}>
            {tx.readCount}/{tx.writeCount}
          </span>
        </div>

        {inbound.length > 0 && (
          <Section title="Forced to wait for">
            {inbound.map((c, i) => {
              const other = txById.get(c.fromId);
              return (
                <Row
                  key={i}
                  left={c.sharedSlots[0] ?? ""}
                  middle={KIND_LABEL[c.kind]}
                  right={`vs ${other?.id ?? c.fromId} (${other?.contractLabel ?? "—"})`}
                  extra={c.sharedSlots.length > 1 ? `+${c.sharedSlots.length - 1} more slot${c.sharedSlots.length - 1 === 1 ? "" : "s"}` : undefined}
                />
              );
            })}
          </Section>
        )}

        {outbound.length > 0 && (
          <Section title={`Blocked these ${outbound.length} later tx${outbound.length === 1 ? "" : "s"}`}>
            {outbound.map((c, i) => {
              const other = txById.get(c.toId);
              return (
                <Row
                  key={i}
                  left={c.sharedSlots[0] ?? ""}
                  middle={KIND_LABEL[c.kind]}
                  right={`→ ${other?.id ?? c.toId} (${other?.contractLabel ?? "—"})`}
                  extra={c.sharedSlots.length > 1 ? `+${c.sharedSlots.length - 1} more slot${c.sharedSlots.length - 1 === 1 ? "" : "s"}` : undefined}
                />
              );
            })}
          </Section>
        )}

        {tx.status === "clean" && (
          <div style={{ color: themeA.muted, fontSize: 12 }}>
            This tx ran in parallel wave 0 with no detected storage conflicts —
            it neither waited for nor blocked any other tx in this block.
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div className="pev-eyebrow" style={{ marginBottom: 6 }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{children}</div>
    </div>
  );
}

function Row({
  left,
  middle,
  right,
  extra,
}: {
  left: string;
  middle: string;
  right: string;
  extra?: string;
}) {
  // shorten "{contract}:{slot}" for display
  const shortSlot = (() => {
    const [, slot] = left.split(":");
    if (!slot) return left;
    if (slot.length <= 18) return slot;
    return slot.slice(0, 10) + "…" + slot.slice(-4);
  })();

  return (
    <div
      style={{
        fontFamily: themeA.mono,
        fontSize: 11,
        padding: "7px 10px",
        background: themeA.altBg,
        borderRadius: 4,
        border: `1px solid ${themeA.border}`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      <span style={{ color: themeA.text }}>{shortSlot}</span>
      <span style={{ color: themeA.subtle, fontSize: 10 }}>{middle}</span>
      <span style={{ color: themeA.muted, marginLeft: "auto" }}>{right}</span>
      {extra && <span style={{ color: themeA.subtle, fontSize: 10 }}>{extra}</span>}
    </div>
  );
}

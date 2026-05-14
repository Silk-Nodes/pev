"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { PEVData, PEVConflict, PEVTx } from "@/lib/probe-to-pev";

/**
 * Shared selection/interaction state for all editorial panels.
 *
 * Cross-pane behavior:
 *   - hovering a tx in Timeline highlights its node in ConflictGraph
 *   - clicking a tx selects it everywhere (Timeline, ConflictGraph, WhyPanel)
 *   - WhyPanel reads `selected` to render the per-tx explanation
 *   - HotSlots dims slots not touched by the selected tx
 *
 * The data itself (txs, conflicts, hotSlots) lives here too so descendant
 * components don't need to drill props or refetch.
 */

export type PEVMode = "execution" | "conflict" | "heatmap";

interface PEVContextValue {
  data: PEVData;
  selected: string | null;
  setSelected: (id: string | null) => void;
  hover: string | null;
  setHover: (id: string | null) => void;
  mode: PEVMode;
  setMode: (m: PEVMode) => void;
  // Derived helpers
  txById: Map<string, PEVTx>;
  conflictsByTx: Map<string, PEVConflict[]>;
  /** neighbor IDs reachable from a tx through any conflict edge */
  neighborsOf: (id: string) => Set<string>;
}

const Ctx = createContext<PEVContextValue | null>(null);

export function PEVProvider({
  data,
  children,
}: {
  data: PEVData;
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [mode, setMode] = useState<PEVMode>("execution");

  const value = useMemo<PEVContextValue>(() => {
    const txById = new Map(data.txs.map((t) => [t.id, t]));
    const conflictsByTx = new Map<string, PEVConflict[]>();
    for (const c of data.conflicts) {
      if (!conflictsByTx.has(c.fromId)) conflictsByTx.set(c.fromId, []);
      if (!conflictsByTx.has(c.toId)) conflictsByTx.set(c.toId, []);
      conflictsByTx.get(c.fromId)!.push(c);
      conflictsByTx.get(c.toId)!.push(c);
    }
    const neighborsOf = (id: string): Set<string> => {
      const out = new Set<string>();
      for (const c of conflictsByTx.get(id) ?? []) {
        if (c.fromId !== id) out.add(c.fromId);
        if (c.toId !== id) out.add(c.toId);
      }
      return out;
    };
    return {
      data,
      selected,
      setSelected,
      hover,
      setHover,
      mode,
      setMode,
      txById,
      conflictsByTx,
      neighborsOf,
    };
  }, [data, selected, hover, mode]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePEV(): PEVContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePEV must be used within <PEVProvider>");
  return v;
}

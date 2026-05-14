import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/middleware";
import { CACHE_HEADERS_IMMUTABLE } from "@/lib/api/cache";
import { queryOne, queryRows } from "@/lib/db";

/**
 * GET /api/v1/tx/:hash
 *
 * Single-tx detail. Joins tx_executions with conflicts to show the full
 * "who blocked who" picture for one tx.
 *
 *   200 → { hash, blockNumber, position, wave, status, ..., conflicts: [...] }
 *   404 → { hash, indexed: false }
 */

export const dynamic = "force-dynamic";

interface TxRow {
  block_number: string;
  tx_hash: Buffer;
  position: number;
  wave: number;
  status: string;
  read_count: number;
  write_count: number;
  inbound_conflicts: number;
  outbound_conflicts: number;
  contracts: Buffer[];
}

interface ConflictRow {
  block_number: string;
  from_position: number;
  to_position: number;
  from_tx_hash: Buffer;
  to_tx_hash: Buffer;
  kind: string;
  shared_slots: string[];
}

export const GET = withApi(
  async (_req, ctx) => {
    const params = await ctx.params;
    const raw = (params.hash ?? "").toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(raw)) {
      return NextResponse.json(
        { error: "invalid tx hash (expected 0x-prefixed 32-byte hex)" },
        { status: 400 },
      );
    }
    const hashBuf = Buffer.from(raw.slice(2), "hex");

    const tx = await queryOne<TxRow>(
      `SELECT block_number::text, tx_hash, position, wave, status,
              read_count, write_count, inbound_conflicts, outbound_conflicts, contracts
         FROM tx_executions WHERE tx_hash = $1`,
      [hashBuf],
    );
    if (!tx) {
      return NextResponse.json(
        { hash: raw, indexed: false },
        { status: 404, headers: { "cache-control": "no-store" } },
      );
    }

    // Conflicts where this tx is either side
    const conflicts = await queryRows<ConflictRow>(
      `SELECT block_number::text, from_position, to_position,
              from_tx_hash, to_tx_hash, kind, shared_slots
         FROM conflicts
        WHERE block_number = $1
          AND (from_tx_hash = $2 OR to_tx_hash = $2)
        ORDER BY from_position, to_position`,
      [tx.block_number, hashBuf],
    );

    return NextResponse.json({
      hash: raw,
      blockNumber: parseInt(tx.block_number, 10),
      position: tx.position,
      wave: tx.wave,
      status: tx.status,
      readCount: tx.read_count,
      writeCount: tx.write_count,
      inboundConflicts: tx.inbound_conflicts,
      outboundConflicts: tx.outbound_conflicts,
      contracts: tx.contracts.map((b) => "0x" + b.toString("hex")),
      conflicts: conflicts.map((c) => ({
        blockNumber: parseInt(c.block_number, 10),
        fromPosition: c.from_position,
        toPosition: c.to_position,
        fromHash: "0x" + c.from_tx_hash.toString("hex"),
        toHash: "0x" + c.to_tx_hash.toString("hex"),
        kind: c.kind,
        sharedSlots: c.shared_slots,
        // Was this tx the one being blocked, or doing the blocking?
        relation: c.from_tx_hash.equals(hashBuf) ? "blocks" : "blocked-by",
      })),
    });
  },
  { cacheHeaders: CACHE_HEADERS_IMMUTABLE },
);

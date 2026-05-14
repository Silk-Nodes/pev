/**
 * GET /api/v1/debug/contract/[address]
 *
 * Tiny diagnostic endpoint that answers one question:
 * "Does pev know about this contract address, and if so what?"
 *
 * Useful when a user pastes a contract from a third-party leaderboard
 * and the contract page shows "not seen yet", this endpoint returns
 * raw counts straight from `tx_executions.contracts[]` so we can tell
 * whether the index is missing the contract entirely vs. just missing
 * recent activity.
 *
 * Output shape:
 *   {
 *     address: "0x...",
 *     indexed: {
 *       rowCount,           total tx_executions rows touching this address
 *       firstBlock,         lowest block_number we've seen it in
 *       lastBlock,          highest, NULL if never seen
 *       firstSeenAt,        timestamp of firstBlock
 *       lastSeenAt,         timestamp of lastBlock
 *       inWindow24h,        true if any row's block is within last 24h
 *       inWindow7d,         true if any row's block is within last 7d
 *     },
 *     chainTip: {
 *       block, timestamp
 *     },
 *     hint: "..."           one-line interpretation for humans
 *   }
 *
 * Public, no auth. Read-only. Bounded with statement_timeout so a
 * popular address can't tie up the server.
 */

import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ address: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
  const { address } = await ctx.params;
  const lower = address.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(lower)) {
    return NextResponse.json(
      { error: "invalid address (expected 0x + 40 hex chars)" },
      { status: 400 },
    );
  }
  const buf = Buffer.from(lower.slice(2), "hex");

  // Chain tip for context.
  const tip = await queryOne<{ number: string; timestamp: Date }>(
    `SELECT max(number)::text AS number,
            (SELECT timestamp FROM blocks ORDER BY number DESC LIMIT 1) AS timestamp
       FROM blocks`,
  );
  const tipNumber = tip?.number ? parseInt(tip.number, 10) : 0;

  // Primary path: contract_index PK lookup. This is a single-row btree
  // probe. Instant for both empty and popular contracts. The table is
  // maintained out-of-band by `pev-contract-index-refresh.timer` (every
  // 15 min). Sidesteps every previous attempt's planner-choice issues.
  interface IndexRow {
    first_block: string;
    last_block: string;
    tx_count: string;
    refreshed_at: Date;
  }
  let lastBlock: number | null = null;
  let lastSeenAt: Date | null = null;
  let firstBlock: number | null = null;
  let txCount: number | null = null;
  let indexRefreshedAt: Date | null = null;
  let timedOut = false;

  try {
    const idxRow = await queryOne<IndexRow>(
      `SELECT first_block::text, last_block::text, tx_count::text, refreshed_at
         FROM contract_index
        WHERE contract = $1`,
      [buf],
    );
    if (idxRow) {
      lastBlock = parseInt(idxRow.last_block, 10);
      firstBlock = parseInt(idxRow.first_block, 10);
      txCount = parseInt(idxRow.tx_count, 10);
      indexRefreshedAt = idxRow.refreshed_at;
      const tsRow = await queryOne<{ timestamp: Date }>(
        `SELECT timestamp FROM blocks WHERE number = $1`,
        [lastBlock],
      );
      lastSeenAt = tsRow?.timestamp ?? null;
    }
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "57014") throw err;
    timedOut = true;
  }

  // Compute window membership from last_block + tip. ~0.5s/block on Monad.
  const blocksPerHour = 7_200;
  const inWindow1h =
    lastBlock !== null && tipNumber > 0
      ? lastBlock >= tipNumber - blocksPerHour
      : false;
  const inWindow24h =
    lastBlock !== null && tipNumber > 0
      ? lastBlock >= tipNumber - blocksPerHour * 24
      : false;
  const inWindow7d =
    lastBlock !== null && tipNumber > 0
      ? lastBlock >= tipNumber - blocksPerHour * 24 * 7
      : false;

  let hint: string;
  if (timedOut) {
    hint =
      "contract_index PK lookup timed out, which should never happen. " +
      "Likely cause: the refresh table doesn't exist yet. Run " +
      "`npm run db:migrate` then `npm run db:refresh-contract-index` " +
      "on the host that runs the indexer.";
  } else if (lastBlock === null) {
    hint =
      "Not in contract_index. Either the contract has never appeared " +
      "in any indexed tx, the address is on a different network, or " +
      "it's a proxy whose implementation is what gets recorded. " +
      "Note: contract_index lags real-time by up to 15 min. A brand " +
      "new deploy may not show until the next refresh tick.";
  } else if (inWindow1h) {
    hint = "Active in the last hour. /contract/<addr> should render fine.";
  } else if (inWindow24h) {
    hint =
      "Active between 1h and 24h ago. /contract/<addr> (default 7d) renders.";
  } else if (inWindow7d) {
    hint =
      "Active between 24h and 7d ago. Use /contract/<addr>?window=7d.";
  } else {
    hint =
      "In the index but quiet for >7 days. Use /contract/<addr>?window=all.";
  }

  return NextResponse.json(
    {
      address: lower,
      indexed: {
        firstBlock,
        lastBlock,
        lastSeenAt,
        txCount,
        inWindow1h,
        inWindow24h,
        inWindow7d,
      },
      contractIndex: {
        // When the contract_index aggregate was last refreshed. Null
        // means this address isn't in the table at all.
        refreshedAt: indexRefreshedAt,
      },
      chainTip: {
        block: tipNumber,
        timestamp: tip?.timestamp ?? null,
      },
      timedOut,
      hint,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

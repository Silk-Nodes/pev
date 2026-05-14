import { NextRequest, NextResponse } from "next/server";

/**
 * Search redirect endpoint. The landing page form posts here.
 * GET /go?block=12345  →  /block/12345
 *
 * Phase 5 will expand this to detect tx hashes (66 chars) and contract
 * addresses (42 chars) and route to /tx/[hash] or /contract/[addr].
 */
export function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("block")?.trim() ?? "";
  const n = raw.startsWith("0x") ? parseInt(raw, 16) : parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) {
    return NextResponse.redirect(new URL("/", req.url));
  }
  return NextResponse.redirect(new URL(`/block/${n}`, req.url));
}

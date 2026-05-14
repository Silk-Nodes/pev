/**
 * og/fonts.ts, runtime font loader for the OG card renderer (Satori).
 *
 * Why this exists:
 *   Satori (the SVG-from-React engine inside next/og's ImageResponse)
 *   doesn't read CSS @font-face, doesn't see next/font's bundled fonts,
 *   and explicitly rejects WOFF/WOFF2. It needs raw TTF/OTF bytes as
 *   ArrayBuffers, passed in via the `fonts` option on ImageResponse.
 *
 *   We bundle the three brand TTF files in src/lib/og/font-files/ and
 *   read them off disk on cold-start. Loaded once per process, cached
 *   in module scope thereafter (~50ms total on first OG render, 0ms
 *   subsequently).
 *
 *   Why not fetch from Google Fonts at runtime? Tried it, modern UAs
 *   get WOFF2 (Satori rejects), old UAs get WOFF (also rejected), and
 *   the only UAs that get TTF are so ancient Google sometimes 404s
 *   the request. Bundling is reliable and adds ~900KB to the build,
 *   which is rounding error for an OG renderer.
 *
 *   The fonts are MIT/OFL-licensed (see ../font-files/LICENSE) and
 *   fine to redistribute.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

interface FontKey {
  /** Absolute or repo-rooted path to the .ttf file */
  filename: string;
}

const cache = new Map<string, Promise<ArrayBuffer>>();

// Resolved at module load time. process.cwd() at runtime is the project
// root for `next start` (verified, the systemd unit cd's there before
// exec). The path is package-relative so it survives ./.next bundling.
const FONT_DIR = path.join(process.cwd(), "src/lib/og/font-files");

async function loadFont(filename: string): Promise<ArrayBuffer> {
  const buf = await readFile(path.join(FONT_DIR, filename));
  // readFile returns a Node Buffer; copy out the underlying bytes as a
  // pure ArrayBuffer (Satori's typing wants ArrayBuffer, not Buffer).
  return buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer;
}

export function getFont({ filename }: FontKey): Promise<ArrayBuffer> {
  let p = cache.get(filename);
  if (!p) {
    p = loadFont(filename).catch((err) => {
      // Evict on failure so the next call retries instead of caching the
      // rejection forever.
      cache.delete(filename);
      throw err;
    });
    cache.set(filename, p);
  }
  return p;
}

/**
 * Convenience: load all four font cuts the OG card template uses, in
 * parallel. Call this from the route handler before `new ImageResponse`.
 *
 *   const fonts = await loadCardFonts();
 *   return new ImageResponse(<Card />, { width, height, fonts });
 *
 * Note: we use static (non-variable) Inter Tight cuts (Medium 500 + Semi
 * 600) because Satori's font parser chokes on variable-font axes with
 * "Cannot read properties of undefined (reading '272')". Static TTFs are
 * ~60KB each, total OG-renderer font payload is well under 1MB.
 */
export async function loadCardFonts(): Promise<
  Array<{
    name: string;
    data: ArrayBuffer;
    weight: 400 | 500 | 600 | 700;
    style: "normal" | "italic";
  }>
> {
  const [interTight500, interTight600, instrumentSerifItalic, jetbrainsMono] =
    await Promise.all([
      getFont({ filename: "InterTight-Medium.ttf" }),
      getFont({ filename: "InterTight-SemiBold.ttf" }),
      getFont({ filename: "InstrumentSerif-Italic.ttf" }),
      getFont({ filename: "JetBrainsMono-Medium.ttf" }),
    ]);

  return [
    { name: "Inter Tight", data: interTight500, weight: 500, style: "normal" },
    { name: "Inter Tight", data: interTight600, weight: 600, style: "normal" },
    {
      name: "Instrument Serif",
      data: instrumentSerifItalic,
      weight: 400,
      style: "italic",
    },
    {
      name: "JetBrains Mono",
      data: jetbrainsMono,
      weight: 500,
      style: "normal",
    },
  ];
}

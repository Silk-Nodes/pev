/**
 * apple-icon.tsx, dynamic 180x180 PNG generated at request time.
 *
 * Next.js App Router convention: a file named `apple-icon.tsx` in the
 * /app directory is auto-served at `/apple-icon.png` and Next.js injects
 * the corresponding `<link rel="apple-touch-icon" ... />` into the HTML
 * head. iOS uses this icon when someone "Add to Home Screen"s pev. Without
 * a real apple-touch-icon, iOS uses a low-quality screenshot of the page,
 * which looks bad. With it, the home-screen tile is the brand mark.
 *
 * Design: the 4-bar PEV mark (per Brand Book) on the ink background,
 * scaled to fill the 180x180 canvas. Rounded corners are added by iOS
 * automatically; we just provide a square. Each bar uses the same hex
 * value as the SVG mark in PEVBrand.tsx so the home-screen tile and the
 * in-page lockup stay visually identical.
 *
 * Why dynamic instead of a static PNG file in /public:
 *   • Source of truth lives in code (one place to update the brand mark)
 *   • Vector-derived rendering stays crisp at any DPI
 *   • Next.js handles caching, content-type, and the head injection
 */

import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0e0d0b",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 16,
          padding: "32px 26px",
          boxSizing: "border-box",
        }}
      >
        {/* 4 bars: sage / amber / ember / terracotta, brand-book widths */}
        <div
          style={{
            height: 22,
            background: "#a8c487",
            width: "100%",
            borderRadius: 3,
          }}
        />
        <div
          style={{
            height: 22,
            background: "#d4a94a",
            width: "58%",
            borderRadius: 3,
          }}
        />
        <div
          style={{
            height: 22,
            background: "#e28c52",
            width: "85%",
            borderRadius: 3,
          }}
        />
        <div
          style={{
            height: 22,
            background: "#c8553d",
            width: "38%",
            borderRadius: 3,
          }}
        />
      </div>
    ),
    { ...size },
  );
}

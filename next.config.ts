import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone, dynamic Node.js app. No static export, no basePath.
  // Server components trace blocks on demand and read from Postgres.

  // Keep these packages OUT of the Next.js bundle, load them via
  // require() at runtime instead. Two reasons we need this:
  //
  //   • `ws` has optional native deps (bufferutil, utf-8-validate). When
  //     bundled, the optional resolution path breaks and you get
  //     `TypeError: b.mask is not a function` the first time the
  //     WebSocket sends a frame. Used by lib/api/chain-head-pump.ts to
  //     subscribe to Monad newHeads for the live LiveStatus tick.
  //
  //   • `pg` is a Node-only Postgres driver with native bindings; same
  //     story, bundling makes it brittle. Used by lib/db.ts.
  //
  // pg-boss pulls in pg internally; including it here saves us hunting
  // a similar error in any route that touches the queue.
  serverExternalPackages: ["ws", "pg", "pg-boss", "bufferutil", "utf-8-validate"],

  /**
   * HTTP response headers applied by Next.js before the response leaves
   * the origin. The Cloudflare tunnel passes these through.
   *
   * Why X-Robots-Tag in addition to the <meta name="robots"> in
   * layout.tsx: the meta tag only applies to HTML responses, but
   * search engines also crawl JSON, images, and other non-HTML
   * resources. X-Robots-Tag is the canonical way to tell them
   * "don't index this" for non-HTML responses, and to mirror the
   * meta-tag policy on HTML responses (defense-in-depth).
   *
   * Policy:
   *   • HTML routes (/, /docs, /analytics, /block/*, /contract/*, /tx/*):
   *     index, follow, max-image-preview:large
   *   • API JSON routes (/api/*): noindex, nofollow. We don't want
   *     Google indexing raw JSON endpoints; the corresponding HTML
   *     page is where the search-result should land.
   *
   * Cloudflare WAF and CDN sometimes strip arbitrary headers; verify
   * via `curl -I https://pev.silknodes.io` after deploy.
   */
  async headers() {
    // Security headers applied to every response. These satisfy the
    // "Best Practices" audits in Lighthouse and follow OWASP's modern
    // baseline. Notes per header:
    //
    //   • Strict-Transport-Security: tells browsers to never speak
    //     plain HTTP to this origin (or subdomains) for 2 years. The
    //     `preload` directive opts into the browser-bundled HSTS list
    //     when submitted at hstspreload.org. Safe for pev because the
    //     site is HTTPS-only by design.
    //
    //   • X-Frame-Options: DENY blocks every iframe embedding. pev's
    //     UX doesn't expect to be embedded anywhere, so this prevents
    //     UI-redress / clickjacking attacks for free.
    //
    //   • X-Content-Type-Options: nosniff stops browsers from
    //     auto-detecting content types, which closes one class of XSS
    //     vectors against our JSON API responses.
    //
    //   • Referrer-Policy: strict-origin-when-cross-origin is the
    //     modern default. Internal links pass full URLs; cross-origin
    //     navigation only leaks the origin, not the path.
    const securityHeaders = [
      {
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    ];
    return [
      {
        source: "/api/:path*",
        headers: [
          ...securityHeaders,
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        // Match every non-API route. Next.js applies rules in source
        // order with more-specific patterns winning, so the /api/*
        // rule above takes precedence for those paths.
        source: "/:path*",
        headers: [
          ...securityHeaders,
          { key: "X-Robots-Tag", value: "index, follow, max-image-preview:large" },
        ],
      },
    ];
  },
};

export default nextConfig;

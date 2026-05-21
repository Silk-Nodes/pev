/**
 * Convert a Next.js ImageResponse (which always outputs RGBA PNG) into
 * a JPEG Response. Use this as the last step in every dynamic OG card
 * route handler:
 *
 *   import { imageResponseAsJpeg } from "@/lib/og/jpeg-response";
 *
 *   const png = new ImageResponse(<MyCard />, { width: 1200, height: 630, fonts });
 *   return imageResponseAsJpeg(png);
 *
 * Why we do this:
 *   Next.js's ImageResponse only emits PNG (via Satori), and the PNGs
 *   it produces have an alpha channel even when every pixel is fully
 *   opaque. X (Twitter) silently refuses to render RGBA OG images in
 *   tweet previews, so dynamic OG cards just showed up as
 *   "no preview image" on X. Static JPEGs work fine. So we pipe the
 *   PNG through sharp → JPEG and serve that instead. Cost: ~20-40ms
 *   per request, negligible because the route caches the response at
 *   the Cloudflare edge anyway.
 *
 *   Tested across X, Discord, Telegram, Slack, LinkedIn at launch
 *   time; JPEG renders everywhere, RGBA PNG fails on X.
 *
 * Quality choice (90): our OG cards are large text + flat color
 * backgrounds. JPEG quality 90 produces visually identical results to
 * the source PNG at roughly half the file size. Higher quality (95+)
 * isn't perceptibly better for this content type; lower (80) starts to
 * show banding on the editorial italic headlines.
 *
 * Progressive + mozjpeg: progressive scans render the card top-to-bottom
 * if a fetcher displays partial loads; mozjpeg's encoder produces
 * better-compressed JPEGs than libjpeg-turbo's default. Both are free
 * wins with sharp.
 */

import sharp from "sharp";

interface Options {
  /** Optional extra response headers (cache-control, etc.) */
  headers?: Record<string, string>;
  /** JPEG quality 1-100. Default 90. */
  quality?: number;
}

export async function imageResponseAsJpeg(
  source: Response,
  options: Options = {},
): Promise<Response> {
  const pngBuffer = Buffer.from(await source.arrayBuffer());
  const jpegBuffer = await sharp(pngBuffer)
    .jpeg({
      quality: options.quality ?? 90,
      mozjpeg: true,
      progressive: true,
    })
    .toBuffer();

  return new Response(new Uint8Array(jpegBuffer), {
    status: 200,
    headers: {
      "content-type": "image/jpeg",
      // Reasonable edge cache: long enough that bot fetches don't hammer
      // the route, short enough that updated card data shows up within
      // a few minutes. Callers can override via options.headers if they
      // need a different policy.
      "cache-control": "public, max-age=300, stale-while-revalidate=600",
      ...options.headers,
    },
  });
}

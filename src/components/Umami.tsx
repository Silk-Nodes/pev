import Script from "next/script";

// Visitor counts for silknodes.io: a self-hosted Umami, cookie-free, no personal data, honours Do
// Not Track. Off unless both values are set at build time, so a build without them ships nothing.
const SRC = process.env.NEXT_PUBLIC_UMAMI_SRC;
const ID = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;

export function Umami() {
  if (!SRC || !ID) return null;
  return <Script src={SRC} data-website-id={ID} data-do-not-track="true" strategy="afterInteractive" />;
}

/** Origin of the tracker, for a Content-Security-Policy; empty when it is off. */
export const UMAMI_ORIGIN = SRC && ID ? new URL(SRC).origin : "";

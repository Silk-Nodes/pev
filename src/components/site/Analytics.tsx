/**
 * Analytics, loads Google Analytics 4 for every visitor.
 *
 * Previously consent-gated via ConsentBanner. We removed the banner
 * because most visitors ignored it, which meant GA recorded almost
 * nothing and we were flying blind on real usage. We keep the GA
 * config minimal (anonymize_ip) and document everything collected on
 * the /privacy page so visitors can see what's tracked and how to
 * block it themselves (uBlock, browser DNT, etc.) if they prefer.
 *
 * Legal note: this is fine for US visitors. For EU/UK visitors, GDPR
 * arguably requires explicit consent for non-essential cookies. We
 * accept that tradeoff for now because pev is early and we need real
 * signal on what's working. If we ever target EU dev community
 * specifically or get a complaint, revisit.
 *
 * To stop tracking entirely: remove this component from layout.tsx.
 * To switch to a no-cookie alternative (Cloudflare Web Analytics,
 * Plausible, Fathom), replace the script tags below with that
 * provider's snippet.
 */

import Script from "next/script";

const GA_MEASUREMENT_ID = "G-LJBQ3W2GNC";

export default function Analytics() {
  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      <Script id="gtag-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_MEASUREMENT_ID}', {
            anonymize_ip: true
          });
        `}
      </Script>
    </>
  );
}

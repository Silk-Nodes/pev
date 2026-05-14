/**
 * /feedback, public feature-request portal for pev.
 *
 * Editorial format matching /docs:
 *   • Hero (what this page is for)
 *   • Submit form (collapsed CTA, expands inline)
 *   • Three sections by status:
 *       - Working on (in_progress + planned)
 *       - Open (vote-friendly, awaiting decision)
 *       - Shipped (recently delivered)
 *   • Declined items are hidden (spam / off-topic)
 *
 * Render path: Server Component fetches the list with the visitor's
 * voter cookie token so we can mark hasVoted per row before HTML
 * leaves the server. VoteButton and SubmitForm are Client Components
 * for interactivity. List render is fully SSR, fast on first paint.
 *
 * Moderation: status changes happen via direct SQL for now.
 *   UPDATE feedback_requests SET status='planned' WHERE id=12;
 * No admin UI; build one when there are enough requests to justify it.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { themeA, palette } from "@/components/parallel/theme";
import SiteHeader, { Crumb, CrumbSep } from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";
import { listFeedback, type FeedbackRequest } from "@/lib/feedback/store";
import { readVoterToken } from "@/lib/feedback/voter";
import { breadcrumbSchema } from "@/lib/seo/schema";
import VoteButton from "./VoteButton";
import SubmitForm from "./SubmitForm";

export const metadata: Metadata = {
  title: {
    absolute: "Feedback and roadmap: what pev should build next",
  },
  description:
    "Suggest features for pev, upvote what matters to you, and see what's planned, in progress, or recently shipped.",
  alternates: {
    canonical: "/feedback",
  },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Feedback & roadmap, pev",
    description:
      "Public feature requests and roadmap. Suggest, upvote, watch what ships.",
    type: "article",
    url: "/feedback",
  },
};

// Always render fresh; lists shift as votes come in.
export const dynamic = "force-dynamic";

export default async function FeedbackPage() {
  const token = await readVoterToken();
  const items = await listFeedback(token);

  // Bucket by visible status for the three sections.
  const working = items.filter(
    (i) => i.status === "in_progress" || i.status === "planned",
  );
  const open = items.filter((i) => i.status === "open");
  const shipped = items.filter((i) => i.status === "shipped");

  return (
    <main
      style={{
        padding: "32px clamp(20px, 4vw, 64px) 80px",
        maxWidth: 1280,
        margin: "0 auto",
      }}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            breadcrumbSchema([
              { name: "pev", url: "/" },
              { name: "feedback", url: "/feedback" },
            ]),
          ),
        }}
      />
      <SiteHeader
        variant="internal"
        tagline="What pev should build next"
        breadcrumb={
          <>
            <Crumb href="/">pev</Crumb>
            <CrumbSep />
            <Crumb current>feedback</Crumb>
          </>
        }
      />

      {/* Hero */}
      <section style={{ marginBottom: 40 }}>
        <div className="pev-eyebrow" style={{ marginBottom: 14 }}>
          Feedback & roadmap
        </div>
        <h1
          className="pev-display-italic"
          style={{
            fontSize: "clamp(32px, 5vw, 52px)",
            color: themeA.text,
            margin: "0 0 18px",
            letterSpacing: "-0.01em",
            lineHeight: 1.1,
          }}
        >
          What pev should build next.
        </h1>
        <p
          style={{
            fontSize: 16,
            color: themeA.muted,
            lineHeight: 1.7,
            maxWidth: "62ch",
            margin: 0,
          }}
        >
          Suggest features, upvote what matters to you, and see what we&apos;re
          working on. Honest signal beats guessing; vote with intention.
        </p>
      </section>

      <SubmitForm />

      {working.length > 0 && (
        <Section
          title="Working on"
          subtitle="Currently being built or already on the roadmap."
          items={working}
        />
      )}

      <Section
        title="Open"
        subtitle="Up for votes. The most-voted requests get prioritized next."
        items={open}
        emptyText="No open requests yet. Be the first; the form is right above."
      />

      {shipped.length > 0 && (
        <Section
          title="Shipped"
          subtitle="Recently delivered. Thanks for the suggestions."
          items={shipped}
          locked
        />
      )}

      {/* About the system */}
      <section
        style={{
          marginTop: 40,
          padding: "16px 18px",
          background: palette.surface03,
          border: `1px dashed ${themeA.border}`,
          borderRadius: themeA.radius,
          maxWidth: "60ch",
        }}
      >
        <div className="pev-eyebrow" style={{ marginBottom: 8 }}>
          How this works
        </div>
        <p
          style={{
            fontSize: 13,
            color: themeA.muted,
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          Anonymous voting via a browser cookie, no login required. We read
          everything, prioritize by votes plus our own judgment about what we
          can build well, and ship visibly. Spam and off-topic submissions
          are removed silently. For anything specific or sensitive, email{" "}
          <a
            href="mailto:info@silknodes.io?subject=pev%20feedback"
            className="pev-link"
          >
            info@silknodes.io
          </a>{" "}
          instead.
        </p>
      </section>

      <p style={{ marginTop: 28 }}>
        <Link href="/" className="pev-link">
          ← back to pev
        </Link>
      </p>

      <SiteFooter />
    </main>
  );
}

function Section({
  title,
  subtitle,
  items,
  emptyText,
  locked = false,
}: {
  title: string;
  subtitle: string;
  items: FeedbackRequest[];
  emptyText?: string;
  /** Locked sections (Shipped) don't let users vote anymore. */
  locked?: boolean;
}) {
  return (
    <section style={{ marginBottom: 40 }}>
      <header style={{ marginBottom: 14 }}>
        {/* Semantic <h2> so the page heading hierarchy is h1 (hero) → h2
            (this section) → h3 (each request). Visually still styled as
            an eyebrow via the class + reset margins/weight. */}
        <h2
          className="pev-eyebrow"
          style={{ margin: "0 0 4px", fontWeight: 400 }}
        >
          {title}
        </h2>
        <div style={{ fontSize: 13, color: themeA.subtle }}>{subtitle}</div>
      </header>

      {items.length === 0 ? (
        <div
          style={{
            padding: "20px 22px",
            background: themeA.panel,
            border: `1px dashed ${themeA.border}`,
            borderRadius: themeA.radius,
            color: themeA.muted,
            fontSize: 13,
            fontStyle: "italic",
            fontFamily: themeA.serif,
          }}
        >
          {emptyText ?? "Nothing here yet."}
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {items.map((req) => (
            <Row key={req.id} req={req} locked={locked} />
          ))}
        </div>
      )}
    </section>
  );
}

function Row({ req, locked }: { req: FeedbackRequest; locked: boolean }) {
  const statusBadge = STATUS_LABEL[req.status];
  return (
    <article
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: 16,
        padding: "16px 18px",
        background: themeA.panel,
        border: `1px solid ${themeA.border}`,
        borderRadius: themeA.radius,
      }}
    >
      <VoteButton
        requestId={req.id}
        initialVoted={req.hasVoted}
        initialCount={req.voteCount}
        disabled={locked}
      />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "baseline",
            flexWrap: "wrap",
            marginBottom: req.description ? 6 : 0,
          }}
        >
          <h3
            style={{
              fontFamily: themeA.sans,
              fontSize: 15,
              color: themeA.text,
              margin: 0,
              fontWeight: 500,
              lineHeight: 1.3,
            }}
          >
            {req.title}
          </h3>
          {statusBadge && (
            <span
              className="pev-mono"
              style={{
                fontSize: 10,
                color: statusBadge.color,
                background: statusBadge.bg,
                border: `1px solid ${statusBadge.color}`,
                padding: "2px 8px",
                borderRadius: 2,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
              }}
            >
              {statusBadge.label}
            </span>
          )}
        </div>
        {req.description && (
          <p
            style={{
              fontSize: 13,
              color: themeA.muted,
              margin: 0,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {req.description}
          </p>
        )}
      </div>
    </article>
  );
}

const STATUS_LABEL: Partial<
  Record<
    FeedbackRequest["status"],
    { label: string; color: string; bg: string }
  >
> = {
  in_progress: {
    label: "In progress",
    color: themeA.status.delayed,
    bg: "rgba(212, 169, 74, 0.08)",
  },
  planned: {
    label: "Planned",
    color: themeA.accent,
    bg: themeA.hintBg,
  },
  shipped: {
    label: "Shipped",
    color: themeA.status.clean,
    bg: "rgba(168, 196, 135, 0.08)",
  },
  // Open and declined intentionally have no badge: open is the default
  // state (no badge needed), declined items aren't shown at all.
};

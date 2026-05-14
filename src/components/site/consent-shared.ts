/**
 * Shared constants between ConsentBanner (writes the decision) and
 * Analytics (reads the decision + listens for change events). Pulled
 * out so we don't risk drift between the two, both files import from
 * here and any rename only happens once.
 */

export const CONSENT_KEY = "pev:analytics-consent";
export const CONSENT_EVENT_ACCEPTED = "pev:consent-accepted";
export const CONSENT_EVENT_DECLINED = "pev:consent-declined";

export type ConsentDecision = "accepted" | "declined" | null;

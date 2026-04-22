import {
  CHANNEL_TYPE_BASELINE,
  OWNER_SPLIT_CHANNELS,
  type Channel,
  type ComplianceLabel,
} from "./types";

// Compliance adjustment applied to reachability_score. A channel that requires
// consent or is outright blocked should never out-rank a channel we can
// actually use today — hence the floor-level penalties.
const COMPLIANCE_ADJUSTMENT: Record<ComplianceLabel, number> = {
  ok: 0,
  ok_manual_only: 0,
  requires_consent: -40,
  restricted_by_region: -30,
  do_not_use: -80,
};

const RECENCY_HINT_RE = {
  // "posted 2 days ago" / "last post 4d" / "posted yesterday"
  veryRecent: /\b(today|yesterday|\d+\s*(h|hour|hr|minute|min)s?|[1-7]\s*(d|day)s?)\b/i,
  recent: /\b(1[0-4]|[8-9])\s*(d|day)s?\b|\b[1-4]\s*(w|week)s?\b/i,
};

function recencyBonus(hint: string | undefined): number {
  if (!hint) return 0;
  if (RECENCY_HINT_RE.veryRecent.test(hint)) return 20;
  if (RECENCY_HINT_RE.recent.test(hint)) return 10;
  return 0;
}

function statusAdjustment(channel: Channel): number {
  // Only "stale" is punished — "unknown" is the honest default when the agent
  // could not verify activity, and penalising it would bias rankings toward
  // whichever channels happened to have a visible post date.
  if (channel.status === "stale") return -25;
  return 0;
}

function responsivenessBonus(channel: Channel): number {
  // Up to +15 for multiple concrete signals (bio CTA, review-reply badge, etc.).
  const signalCount = channel.responsiveness_signals.filter((s) => s.trim().length > 0).length;
  return Math.min(15, signalCount * 6);
}

function ownerScopeBonus(channel: Channel): number {
  if (channel.scope !== "owner_personal") return 0;
  return OWNER_SPLIT_CHANNELS.has(channel.type) ? 15 : 0;
}

// Deterministic re-score. The agent emits a reachability_score but can drift
// (e.g., assigning 95 to an email where the contact form 404s). This function
// is the ground truth the ranker uses.
export function computeReachabilityScore(channel: Channel): number {
  const baseline = CHANNEL_TYPE_BASELINE[channel.type] ?? 0;
  const raw =
    baseline +
    recencyBonus(channel.last_activity_hint) +
    responsivenessBonus(channel) +
    ownerScopeBonus(channel) +
    statusAdjustment(channel) +
    COMPLIANCE_ADJUSTMENT[channel.compliance_label];
  return Math.max(0, Math.min(100, Math.round(raw)));
}

// Applies computeReachabilityScore in place (returns a new array; inputs are
// not mutated). Channels with reachability_score ≤ 0 after scoring are kept —
// the ranker decides whether to include them. We do not drop here so the UI
// can still show a "we found it but it's unusable" state.
export function rescoreChannels(channels: readonly Channel[]): Channel[] {
  return channels.map((c) => ({ ...c, reachability_score: computeReachabilityScore(c) }));
}

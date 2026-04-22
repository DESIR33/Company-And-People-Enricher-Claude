// Channel types for multi-channel contact enrichment. All channels produced by
// the agent pass through this shape before being stored, scored, or ranked.

export const CHANNEL_TYPES = [
  "business_phone_call",
  "sms_mobile",
  "whatsapp",
  "instagram_dm",
  "facebook_messenger",
  "tiktok_dm",
  "youtube",
  "nextdoor",
  "yelp_angi_thumbtack",
  "email",
] as const;

export type ChannelType = (typeof CHANNEL_TYPES)[number];

// Which of the 10 channels support an owner-personal vs business split. Used by
// the scoring wrapper to award an owner-personal bonus only where it actually
// makes sense.
export const OWNER_SPLIT_CHANNELS: ReadonlySet<ChannelType> = new Set<ChannelType>([
  "sms_mobile",
  "instagram_dm",
  "tiktok_dm",
  "facebook_messenger",
]);

export type ChannelScope = "business" | "owner_personal";

export type ChannelStatus = "likely_active" | "stale" | "unknown";

export const COMPLIANCE_LABELS = [
  "ok",
  "ok_manual_only",
  "requires_consent",
  "restricted_by_region",
  "do_not_use",
] as const;

export type ComplianceLabel = (typeof COMPLIANCE_LABELS)[number];

export type Channel = {
  type: ChannelType;
  scope: ChannelScope;
  value: string;
  url?: string;
  status: ChannelStatus;
  last_activity_hint?: string;
  reachability_score: number;
  responsiveness_signals: string[];
  compliance_label: ComplianceLabel;
  compliance_note: string;
  first_line: string;
  rank: number;
  rank_rationale: string;
};

// Channel-type baseline response-rate priors. These feed the deterministic
// re-scorer so the agent can't just emit implausibly high scores for
// historically weak channels. Numbers are rough industry heuristics; the goal
// is ordinal (SMS > IG > call > email) not precision.
export const CHANNEL_TYPE_BASELINE: Record<ChannelType, number> = {
  sms_mobile: 30,
  instagram_dm: 26,
  whatsapp: 25,
  tiktok_dm: 22,
  facebook_messenger: 20,
  business_phone_call: 18,
  yelp_angi_thumbtack: 16,
  nextdoor: 15,
  email: 10,
  youtube: 8,
};

// Human labels for CSV headers + UI. Single source of truth.
export const CHANNEL_TYPE_LABEL: Record<ChannelType, string> = {
  business_phone_call: "Business Phone Call",
  sms_mobile: "SMS (Mobile)",
  whatsapp: "WhatsApp",
  instagram_dm: "Instagram DM",
  facebook_messenger: "Facebook Messenger",
  tiktok_dm: "TikTok DM",
  youtube: "YouTube",
  nextdoor: "Nextdoor",
  yelp_angi_thumbtack: "Yelp / Angi / Thumbtack",
  email: "Email",
};

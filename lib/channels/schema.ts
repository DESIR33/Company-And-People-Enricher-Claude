import { z } from "zod";
import {
  CHANNEL_TYPES,
  COMPLIANCE_LABELS,
  type Channel,
  type ChannelType,
} from "./types";

const RawChannelSchema = z.object({
  type: z.enum(CHANNEL_TYPES),
  scope: z.enum(["business", "owner_personal"]).default("business"),
  value: z.string().trim().min(1),
  url: z.string().trim().optional(),
  status: z.enum(["likely_active", "stale", "unknown"]).default("unknown"),
  last_activity_hint: z.string().trim().optional(),
  reachability_score: z.coerce.number().int().min(0).max(100).default(0),
  responsiveness_signals: z.array(z.string().trim()).default([]),
  compliance_label: z.enum(COMPLIANCE_LABELS).default("ok"),
  compliance_note: z.string().trim().default(""),
  first_line: z.string().trim().default(""),
  rank_rationale: z.string().trim().default(""),
});

// Parse a raw agent-emitted channels array into strict Channel[]. Malformed
// entries are dropped silently rather than throwing — the agent can produce
// dozens of channels and one broken entry should not fail the whole row.
// Duplicate (type, scope) pairs are collapsed (first wins) so a fumbling agent
// does not double-count a channel in ranking.
export function parseChannels(raw: unknown): Channel[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Channel[] = [];
  for (const entry of raw) {
    const parsed = RawChannelSchema.safeParse(entry);
    if (!parsed.success) continue;
    const data = parsed.data;
    const key = `${data.type}::${data.scope}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      type: data.type as ChannelType,
      scope: data.scope,
      value: data.value,
      url: data.url,
      status: data.status,
      last_activity_hint: data.last_activity_hint,
      reachability_score: data.reachability_score,
      responsiveness_signals: data.responsiveness_signals,
      compliance_label: data.compliance_label,
      compliance_note: data.compliance_note,
      first_line: data.first_line,
      rank: 0, // filled in by ranker
      rank_rationale: data.rank_rationale,
    });
  }
  return out;
}

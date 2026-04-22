import type { Channel } from "./types";

export const DEFAULT_MAX_FLATTENED_CHANNELS = 5;

// Column suffixes produced per ranked channel. Order determines CSV column order.
export const CHANNEL_COLUMN_SUFFIXES = [
  "type",
  "scope",
  "value",
  "url",
  "score",
  "status",
  "compliance",
  "compliance_note",
  "first_line",
  "rank_rationale",
] as const;

type Suffix = (typeof CHANNEL_COLUMN_SUFFIXES)[number];

function cellFor(channel: Channel, suffix: Suffix): string {
  switch (suffix) {
    case "type":            return channel.type;
    case "scope":           return channel.scope;
    case "value":           return channel.value;
    case "url":             return channel.url ?? "";
    case "score":           return String(channel.reachability_score);
    case "status":          return channel.status;
    case "compliance":      return channel.compliance_label;
    case "compliance_note": return channel.compliance_note;
    case "first_line":      return channel.first_line;
    case "rank_rationale":  return channel.rank_rationale;
  }
}

// Produce the header list for ranked columns. Stable across all rows so the
// CSV has consistent columns even when some rows have fewer channels.
export function flattenedChannelHeaders(maxChannels = DEFAULT_MAX_FLATTENED_CHANNELS): string[] {
  const headers: string[] = [];
  for (let i = 1; i <= maxChannels; i++) {
    for (const s of CHANNEL_COLUMN_SUFFIXES) {
      headers.push(`channel_${i}_${s}`);
    }
  }
  headers.push("channels_json");
  return headers;
}

// Flatten a row's ranked channels into the shape expected by the CSV. Channels
// beyond maxChannels are preserved in the JSON blob but not in flat columns.
export function flattenChannels(
  channels: readonly Channel[],
  maxChannels = DEFAULT_MAX_FLATTENED_CHANNELS
): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < maxChannels; i++) {
    const channel = channels[i];
    for (const s of CHANNEL_COLUMN_SUFFIXES) {
      out[`channel_${i + 1}_${s}`] = channel ? cellFor(channel, s) : "";
    }
  }
  out.channels_json = channels.length > 0 ? JSON.stringify(channels) : "";
  return out;
}

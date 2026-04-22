import type { Channel, ChannelType } from "./types";

// Normalise a raw suppression-list entry so it matches regardless of the
// surface format the agent returned the channel in. Rules:
// - Emails → lowercase + trimmed.
// - Phone-like inputs → digits-only, leading `1` country code dropped so a
//   US number matches whether the user pasted +1, 1, or nothing.
// - Handles → strip leading `@`, lowercase.
// - URLs → lowercase, strip trailing slashes, strip any query string.
export function normaliseSuppressionKey(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.includes("@") && !trimmed.startsWith("@")) {
    // Likely an email.
    return trimmed.toLowerCase();
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.toLowerCase().split("?")[0].replace(/\/+$/, "");
  }
  if (/^[+\d][\d\s\-().]+$/.test(trimmed)) {
    // Phone-ish: keep digits only, drop leading 1 for US-equivalence.
    const digits = trimmed.replace(/\D/g, "");
    return digits.replace(/^1(?=\d{10}$)/, "");
  }
  // Handle / generic token.
  return trimmed.replace(/^@/, "").toLowerCase();
}

function normaliseValue(type: ChannelType, value: string, url?: string): string[] {
  const keys = new Set<string>();
  const add = (s: string) => {
    const k = normaliseSuppressionKey(s);
    if (k) keys.add(k);
  };
  add(value);
  if (url) add(url);
  // Phone-like channels also match raw digits / +E.164 formats.
  if (
    type === "business_phone_call" ||
    type === "sms_mobile" ||
    type === "whatsapp"
  ) {
    add(value.replace(/\D/g, ""));
    if (url) add(url.replace(/\D/g, ""));
  }
  return [...keys];
}

export type SuppressionIndex = ReadonlySet<string>;

export function buildSuppressionIndex(raw: readonly string[] | undefined): SuppressionIndex {
  const set = new Set<string>();
  if (!raw) return set;
  for (const entry of raw) {
    const key = normaliseSuppressionKey(entry);
    if (key) set.add(key);
  }
  return set;
}

// Walks the channel list and flips any channel whose value / url matches the
// suppression index to compliance_label="do_not_use" with an explanatory note.
// The ranker re-runs after this so suppressed channels fall to the bottom of
// the list.
export function applySuppression(
  channels: readonly Channel[],
  index: SuppressionIndex
): Channel[] {
  if (index.size === 0) return channels.map((c) => ({ ...c }));
  return channels.map((c) => {
    const keys = normaliseValue(c.type, c.value, c.url);
    const hit = keys.some((k) => index.has(k));
    if (!hit) return { ...c };
    const prior = c.compliance_note;
    return {
      ...c,
      compliance_label: "do_not_use",
      compliance_note: prior
        ? `Suppressed by user-provided list; original note: ${prior}`
        : "Suppressed by user-provided list (previously contacted / opted out).",
    };
  });
}

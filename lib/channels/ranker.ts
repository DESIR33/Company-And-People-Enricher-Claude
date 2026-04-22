import type { Channel, ChannelType } from "./types";

// Stable tie-break ordering when two channels end up with the same score. This
// is the editorial preference: SMBs respond fastest on SMS/IG/WhatsApp, so
// when everything else is equal those should surface first.
const TIE_BREAK_PRIORITY: Record<ChannelType, number> = {
  sms_mobile: 1,
  instagram_dm: 2,
  whatsapp: 3,
  business_phone_call: 4,
  tiktok_dm: 5,
  facebook_messenger: 6,
  yelp_angi_thumbtack: 7,
  nextdoor: 8,
  email: 9,
  youtube: 10,
};

export function rankChannels(channels: readonly Channel[]): Channel[] {
  const sorted = [...channels].sort((a, b) => {
    if (b.reachability_score !== a.reachability_score) {
      return b.reachability_score - a.reachability_score;
    }
    // Owner-personal scope wins at same score — it's usually more responsive.
    if (a.scope !== b.scope) {
      return a.scope === "owner_personal" ? -1 : 1;
    }
    return (TIE_BREAK_PRIORITY[a.type] ?? 99) - (TIE_BREAK_PRIORITY[b.type] ?? 99);
  });
  return sorted.map((c, i) => ({ ...c, rank: i + 1 }));
}

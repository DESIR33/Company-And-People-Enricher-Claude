import type { Channel, ChannelType } from "./types";

export type DeepLink = {
  // Full URL the browser can open directly. When null, the channel does not
  // have a canonical deep-link format and the UI should just show a copy
  // action instead of an "Open" button.
  href: string | null;
  // Short human label for the open action (e.g. "Call", "Text", "DM").
  label: string;
};

function digitsOnly(s: string): string {
  return s.replace(/[^\d+]/g, "");
}

// E.164-ish normaliser for phone fields. Best-effort — leaves the agent's
// output untouched if the string does not look phone-like, since tel: and
// sms: URIs accept whatever the handset can parse.
function normalisePhone(value: string): string {
  const cleaned = digitsOnly(value);
  if (cleaned.startsWith("+")) return cleaned;
  // 10-digit US-style → prepend +1. Heuristic, not exhaustive.
  if (cleaned.length === 10) return `+1${cleaned}`;
  // 11-digit starting with 1 → prepend +.
  if (cleaned.length === 11 && cleaned.startsWith("1")) return `+${cleaned}`;
  return cleaned || value;
}

// wa.me accepts digits only, no + prefix.
function waMeDigits(value: string): string {
  const cleaned = digitsOnly(value).replace(/^\+/, "");
  return cleaned;
}

function normaliseHandle(raw: string): string {
  return raw.trim().replace(/^@/, "");
}

function asHttpsUrl(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(v)) return `https://${v}`;
  return null;
}

// Per-channel deep-link builder. Uses url field when present, otherwise derives
// a canonical URL from value. Returns null href when we cannot produce a
// browser-openable URL (e.g. a raw email address works via mailto: but a bare
// handle for YouTube without a channel URL does not).
export function buildDeepLink(channel: Channel): DeepLink {
  const value = channel.value.trim();
  const url = channel.url?.trim();
  if (!value && !url) return { href: null, label: openLabelFor(channel.type) };

  switch (channel.type) {
    case "business_phone_call": {
      const phone = normalisePhone(value || url || "");
      return phone ? { href: `tel:${phone}`, label: "Call" } : { href: null, label: "Call" };
    }
    case "sms_mobile": {
      const phone = normalisePhone(value || url || "");
      return phone ? { href: `sms:${phone}`, label: "Text" } : { href: null, label: "Text" };
    }
    case "whatsapp": {
      // Prefer an explicit wa.me URL if the agent gave one.
      if (url && /wa\.me\//i.test(url)) return { href: url, label: "WhatsApp" };
      const digits = waMeDigits(value || url || "");
      return digits
        ? { href: `https://wa.me/${digits}`, label: "WhatsApp" }
        : { href: null, label: "WhatsApp" };
    }
    case "instagram_dm": {
      const handle = normaliseHandle(value);
      if (url && /instagram\.com\//i.test(url)) return { href: url, label: "Open IG" };
      return handle
        ? { href: `https://instagram.com/${handle}`, label: "Open IG" }
        : { href: null, label: "Open IG" };
    }
    case "facebook_messenger": {
      if (url && /m\.me\//i.test(url)) return { href: url, label: "Open Messenger" };
      if (url && /facebook\.com\//i.test(url)) return { href: url, label: "Open Messenger" };
      const maybeUrl = asHttpsUrl(value);
      if (maybeUrl) return { href: maybeUrl, label: "Open Messenger" };
      // A bare page-name without a URL does not resolve to a known m.me path
      // (m.me/<username> only works if the page claimed that username), so we
      // cannot guarantee a working deep link here.
      return { href: null, label: "Open Messenger" };
    }
    case "tiktok_dm": {
      const handle = normaliseHandle(value);
      if (url && /tiktok\.com\//i.test(url)) return { href: url, label: "Open TikTok" };
      return handle
        ? { href: `https://www.tiktok.com/@${handle}`, label: "Open TikTok" }
        : { href: null, label: "Open TikTok" };
    }
    case "youtube": {
      const maybe = asHttpsUrl(url || value);
      return maybe
        ? { href: maybe, label: "Open YouTube" }
        : { href: null, label: "Open YouTube" };
    }
    case "nextdoor":
    case "yelp_angi_thumbtack": {
      const maybe = asHttpsUrl(url || value);
      return maybe
        ? { href: maybe, label: "Open profile" }
        : { href: null, label: "Open profile" };
    }
    case "email": {
      const addr = value.trim();
      if (!addr || !/@/.test(addr)) return { href: null, label: "Email" };
      return { href: `mailto:${encodeURIComponent(addr)}`, label: "Email" };
    }
  }
}

function openLabelFor(type: ChannelType): string {
  switch (type) {
    case "business_phone_call": return "Call";
    case "sms_mobile":          return "Text";
    case "whatsapp":            return "WhatsApp";
    case "instagram_dm":        return "Open IG";
    case "facebook_messenger":  return "Open Messenger";
    case "tiktok_dm":           return "Open TikTok";
    case "youtube":             return "Open YouTube";
    case "nextdoor":            return "Open profile";
    case "yelp_angi_thumbtack": return "Open profile";
    case "email":               return "Email";
  }
}

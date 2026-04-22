import { describe, expect, it } from "vitest";
import { buildDeepLink } from "./deeplink";
import type { Channel } from "./types";

function ch(overrides: Partial<Channel>): Channel {
  return {
    type: "email",
    scope: "business",
    value: "",
    status: "unknown",
    reachability_score: 0,
    responsiveness_signals: [],
    compliance_label: "ok",
    compliance_note: "",
    first_line: "",
    rank: 0,
    rank_rationale: "",
    ...overrides,
  };
}

describe("buildDeepLink", () => {
  it("produces tel: for phone calls and normalises 10-digit US numbers", () => {
    expect(buildDeepLink(ch({ type: "business_phone_call", value: "(404) 555-1234" })))
      .toEqual({ href: "tel:+14045551234", label: "Call" });
  });

  it("preserves + prefix when already E.164", () => {
    expect(buildDeepLink(ch({ type: "business_phone_call", value: "+442079460018" })))
      .toEqual({ href: "tel:+442079460018", label: "Call" });
  });

  it("produces sms: for SMS-mobile", () => {
    expect(buildDeepLink(ch({ type: "sms_mobile", value: "404-555-1234" })).href)
      .toBe("sms:+14045551234");
  });

  it("builds wa.me URLs with digits only (no plus)", () => {
    expect(buildDeepLink(ch({ type: "whatsapp", value: "+1 (404) 555-1234" })).href)
      .toBe("https://wa.me/14045551234");
  });

  it("prefers existing wa.me URL when agent provides one", () => {
    expect(buildDeepLink(ch({ type: "whatsapp", value: "x", url: "https://wa.me/5511999990000" })).href)
      .toBe("https://wa.me/5511999990000");
  });

  it("builds instagram.com URLs stripping a leading @", () => {
    expect(buildDeepLink(ch({ type: "instagram_dm", value: "@joes_plumbing" })).href)
      .toBe("https://instagram.com/joes_plumbing");
  });

  it("uses the url field when instagram value is blank", () => {
    const link = buildDeepLink(ch({ type: "instagram_dm", value: "@x", url: "https://instagram.com/realhandle" }));
    expect(link.href).toBe("https://instagram.com/realhandle");
  });

  it("returns null href for Facebook Messenger when no URL is provided", () => {
    const link = buildDeepLink(ch({ type: "facebook_messenger", value: "Joe's Pizza" }));
    expect(link.href).toBeNull();
    expect(link.label).toBe("Open Messenger");
  });

  it("uses m.me / facebook.com URLs when provided", () => {
    expect(buildDeepLink(ch({ type: "facebook_messenger", value: "x", url: "https://m.me/joespizza" })).href)
      .toBe("https://m.me/joespizza");
    expect(buildDeepLink(ch({ type: "facebook_messenger", value: "x", url: "https://facebook.com/joespizza" })).href)
      .toBe("https://facebook.com/joespizza");
  });

  it("builds tiktok URLs with a leading @ path segment", () => {
    expect(buildDeepLink(ch({ type: "tiktok_dm", value: "@nailsbymari" })).href)
      .toBe("https://www.tiktok.com/@nailsbymari");
  });

  it("wraps bare domains in https:// for youtube / yelp / nextdoor", () => {
    expect(buildDeepLink(ch({ type: "youtube", value: "youtube.com/@someone" })).href)
      .toBe("https://youtube.com/@someone");
    expect(buildDeepLink(ch({ type: "nextdoor", value: "nextdoor.com/pages/joe-plumbing" })).href)
      .toBe("https://nextdoor.com/pages/joe-plumbing");
    expect(buildDeepLink(ch({ type: "yelp_angi_thumbtack", value: "yelp.com/biz/joes-pizza-atlanta" })).href)
      .toBe("https://yelp.com/biz/joes-pizza-atlanta");
  });

  it("produces mailto: for valid emails", () => {
    expect(buildDeepLink(ch({ type: "email", value: "hi@example.com" })).href)
      .toBe("mailto:hi%40example.com");
  });

  it("returns null href for emails missing an @ symbol", () => {
    expect(buildDeepLink(ch({ type: "email", value: "not-an-email" })).href).toBeNull();
  });

  it("returns null href when both value and url are blank", () => {
    expect(buildDeepLink(ch({ type: "instagram_dm", value: "" })).href).toBeNull();
    expect(buildDeepLink(ch({ type: "business_phone_call", value: "" })).href).toBeNull();
  });
});

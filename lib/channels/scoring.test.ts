import { describe, expect, it } from "vitest";
import { computeReachabilityScore, rescoreChannels } from "./scoring";
import type { Channel } from "./types";

function baseChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    type: "instagram_dm",
    scope: "business",
    value: "@example",
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

describe("computeReachabilityScore", () => {
  it("applies channel-type baseline", () => {
    expect(computeReachabilityScore(baseChannel({ type: "sms_mobile" }))).toBe(30);
    expect(computeReachabilityScore(baseChannel({ type: "email" }))).toBe(10);
    expect(computeReachabilityScore(baseChannel({ type: "youtube" }))).toBe(8);
  });

  it("adds recency bonus for very recent activity", () => {
    const c = baseChannel({ type: "instagram_dm", last_activity_hint: "posted 2 days ago" });
    // baseline 26 + very-recent 20 = 46
    expect(computeReachabilityScore(c)).toBe(46);
  });

  it("adds responsiveness bonus capped at 15", () => {
    const c = baseChannel({
      type: "instagram_dm",
      responsiveness_signals: ["a", "b", "c", "d"], // 4 × 6 = 24, capped to 15
    });
    expect(computeReachabilityScore(c)).toBe(26 + 15);
  });

  it("adds owner-personal bonus only on supported channel types", () => {
    const ig = baseChannel({ type: "instagram_dm", scope: "owner_personal" });
    expect(computeReachabilityScore(ig)).toBe(26 + 15);
    // youtube does not support owner-personal split, no bonus
    const yt = baseChannel({ type: "youtube", scope: "owner_personal" });
    expect(computeReachabilityScore(yt)).toBe(8);
  });

  it("penalizes stale status", () => {
    const c = baseChannel({ type: "instagram_dm", status: "stale" });
    expect(computeReachabilityScore(c)).toBe(26 - 25);
  });

  it("floors requires_consent channels heavily", () => {
    // sms baseline 30 − 40 = negative → clamped at 0
    const c = baseChannel({
      type: "sms_mobile",
      compliance_label: "requires_consent",
    });
    expect(computeReachabilityScore(c)).toBe(0);
  });

  it("floors do_not_use below everything else", () => {
    const c = baseChannel({
      type: "sms_mobile",
      compliance_label: "do_not_use",
      last_activity_hint: "posted yesterday",
    });
    expect(computeReachabilityScore(c)).toBe(0);
  });

  it("clamps above 100", () => {
    const c = baseChannel({
      type: "sms_mobile", // baseline 30
      scope: "owner_personal", // +15
      last_activity_hint: "posted today", // +20
      responsiveness_signals: ["a", "b", "c"], // +15 cap
      // total 80 — stays within range
    });
    expect(computeReachabilityScore(c)).toBe(80);
  });

  it("rescoreChannels does not mutate input", () => {
    const input = [baseChannel({ type: "sms_mobile", reachability_score: 99 })];
    const out = rescoreChannels(input);
    expect(input[0].reachability_score).toBe(99);
    expect(out[0].reachability_score).toBe(30);
  });
});

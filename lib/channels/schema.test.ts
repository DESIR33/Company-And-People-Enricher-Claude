import { describe, expect, it } from "vitest";
import { parseChannels } from "./schema";

describe("parseChannels", () => {
  it("returns [] for non-array input", () => {
    expect(parseChannels(null)).toEqual([]);
    expect(parseChannels(undefined)).toEqual([]);
    expect(parseChannels("nope")).toEqual([]);
    expect(parseChannels({})).toEqual([]);
  });

  it("drops malformed entries but keeps valid ones", () => {
    const raw = [
      { type: "instagram_dm", scope: "business", value: "@joe" },
      { type: "not_a_real_channel", value: "x" }, // invalid type
      { type: "sms_mobile", value: "" }, // empty value
      { type: "email", value: "hi@example.com", scope: "business" },
    ];
    const result = parseChannels(raw);
    expect(result.map((c) => c.type)).toEqual(["instagram_dm", "email"]);
  });

  it("defaults optional fields to stable values", () => {
    const result = parseChannels([
      { type: "whatsapp", value: "+14045551234" },
    ]);
    expect(result[0]).toMatchObject({
      type: "whatsapp",
      scope: "business",
      status: "unknown",
      reachability_score: 0,
      responsiveness_signals: [],
      compliance_label: "ok",
      compliance_note: "",
      first_line: "",
      rank: 0,
    });
  });

  it("collapses duplicate (type, scope) pairs — first wins", () => {
    const raw = [
      { type: "instagram_dm", scope: "business", value: "@first" },
      { type: "instagram_dm", scope: "business", value: "@second" },
      { type: "instagram_dm", scope: "owner_personal", value: "@owner" }, // different scope → kept
    ];
    const result = parseChannels(raw);
    expect(result).toHaveLength(2);
    expect(result[0].value).toBe("@first");
    expect(result[1].scope).toBe("owner_personal");
  });

  it("does not throw on deeply broken input", () => {
    expect(() => parseChannels([42, "string", { garbage: true }])).not.toThrow();
    expect(parseChannels([42, "string", { garbage: true }])).toEqual([]);
  });

  it("coerces numeric-string reachability_score", () => {
    const result = parseChannels([
      { type: "sms_mobile", value: "+14045551234", reachability_score: "75" },
    ]);
    expect(result[0].reachability_score).toBe(75);
  });
});

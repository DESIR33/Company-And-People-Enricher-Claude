import { describe, expect, it } from "vitest";
import {
  applySuppression,
  buildSuppressionIndex,
  normaliseSuppressionKey,
} from "./suppression";
import type { Channel } from "./types";

function ch(overrides: Partial<Channel>): Channel {
  return {
    type: "email",
    scope: "business",
    value: "",
    status: "unknown",
    reachability_score: 60,
    responsiveness_signals: [],
    compliance_label: "ok",
    compliance_note: "",
    first_line: "",
    rank: 0,
    rank_rationale: "",
    ...overrides,
  };
}

describe("normaliseSuppressionKey", () => {
  it("lowercases emails", () => {
    expect(normaliseSuppressionKey("Hi@Example.Com")).toBe("hi@example.com");
  });

  it("reduces US phone numbers to 10 digits regardless of punctuation / leading 1", () => {
    expect(normaliseSuppressionKey("+1 (404) 555-1234")).toBe("4045551234");
    expect(normaliseSuppressionKey("1-404-555-1234")).toBe("4045551234");
    expect(normaliseSuppressionKey("404.555.1234")).toBe("4045551234");
  });

  it("preserves non-US international numbers as full digit strings", () => {
    // Nine digits — does not match the US stripping heuristic.
    expect(normaliseSuppressionKey("+44 20 7946 0018")).toBe("442079460018");
  });

  it("strips leading @ and lowercases handles", () => {
    expect(normaliseSuppressionKey("@JoesPlumbing")).toBe("joesplumbing");
  });

  it("strips trailing slashes and query strings from URLs", () => {
    expect(normaliseSuppressionKey("https://Instagram.com/joes/?ref=share"))
      .toBe("https://instagram.com/joes");
  });
});

describe("applySuppression", () => {
  const index = buildSuppressionIndex([
    "hi@example.com",
    "+1 404-555-1234",
    "@joesplumbing",
    "https://instagram.com/old-handle/",
  ]);

  it("demotes channels whose value is on the list", () => {
    const out = applySuppression(
      [
        ch({ type: "email", value: "HI@example.com" }),
        ch({ type: "sms_mobile", value: "(404) 555-1234" }),
        ch({ type: "instagram_dm", value: "@JoesPlumbing" }),
      ],
      index
    );
    expect(out.map((c) => c.compliance_label)).toEqual([
      "do_not_use",
      "do_not_use",
      "do_not_use",
    ]);
    expect(out[0].compliance_note).toMatch(/Suppressed/);
  });

  it("matches by url when value is not a direct match", () => {
    const out = applySuppression(
      [ch({ type: "instagram_dm", value: "@different", url: "https://instagram.com/old-handle" })],
      index
    );
    expect(out[0].compliance_label).toBe("do_not_use");
  });

  it("leaves non-matching channels untouched", () => {
    const out = applySuppression(
      [ch({ type: "email", value: "new@example.com", compliance_label: "ok" })],
      index
    );
    expect(out[0].compliance_label).toBe("ok");
  });

  it("is a no-op for empty suppression index", () => {
    const empty = buildSuppressionIndex(undefined);
    const channels = [ch({ type: "email", value: "anything@anywhere.com" })];
    const out = applySuppression(channels, empty);
    expect(out[0].compliance_label).toBe("ok");
  });

  it("preserves the prior compliance_note in the suppression message", () => {
    const out = applySuppression(
      [ch({ type: "email", value: "hi@example.com", compliance_note: "cold email OK under CAN-SPAM" })],
      index
    );
    expect(out[0].compliance_note).toContain("Suppressed");
    expect(out[0].compliance_note).toContain("cold email OK under CAN-SPAM");
  });

  it("does not mutate inputs", () => {
    const input = [ch({ type: "email", value: "hi@example.com" })];
    applySuppression(input, index);
    expect(input[0].compliance_label).toBe("ok");
  });
});

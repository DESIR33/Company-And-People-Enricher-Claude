import { describe, expect, it } from "vitest";
import { rankChannels } from "./ranker";
import type { Channel } from "./types";

function c(type: Channel["type"], score: number, scope: Channel["scope"] = "business"): Channel {
  return {
    type,
    scope,
    value: "x",
    status: "unknown",
    reachability_score: score,
    responsiveness_signals: [],
    compliance_label: "ok",
    compliance_note: "",
    first_line: "",
    rank: 0,
    rank_rationale: "",
  };
}

describe("rankChannels", () => {
  it("orders by reachability_score descending", () => {
    const result = rankChannels([c("email", 40), c("sms_mobile", 70), c("whatsapp", 55)]);
    expect(result.map((r) => r.type)).toEqual(["sms_mobile", "whatsapp", "email"]);
    expect(result.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("breaks ties by owner-personal scope first", () => {
    const result = rankChannels([
      c("instagram_dm", 40, "business"),
      c("instagram_dm", 40, "owner_personal"),
    ]);
    expect(result[0].scope).toBe("owner_personal");
    expect(result[0].rank).toBe(1);
  });

  it("breaks same-score same-scope ties by channel-type priority", () => {
    // SMS ranks above IG at tied scores
    const result = rankChannels([c("instagram_dm", 50), c("sms_mobile", 50)]);
    expect(result[0].type).toBe("sms_mobile");
    expect(result[1].type).toBe("instagram_dm");
  });

  it("is stable across repeated calls on equivalent inputs", () => {
    const a = rankChannels([c("email", 20), c("email", 20, "owner_personal")]);
    const b = rankChannels([c("email", 20, "owner_personal"), c("email", 20)]);
    expect(a.map((r) => r.scope)).toEqual(b.map((r) => r.scope));
  });

  it("does not mutate inputs", () => {
    const input = [c("email", 1)];
    rankChannels(input);
    expect(input[0].rank).toBe(0);
  });
});

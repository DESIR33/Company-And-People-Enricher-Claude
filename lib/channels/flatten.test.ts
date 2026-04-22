import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_FLATTENED_CHANNELS,
  flattenChannels,
  flattenedChannelHeaders,
} from "./flatten";
import type { Channel } from "./types";

function mk(i: number, overrides: Partial<Channel> = {}): Channel {
  return {
    type: "instagram_dm",
    scope: "business",
    value: `val${i}`,
    status: "likely_active",
    reachability_score: 80 - i * 5,
    responsiveness_signals: [],
    compliance_label: "ok_manual_only",
    compliance_note: `note ${i}`,
    first_line: `first line ${i}`,
    rank: i,
    rank_rationale: `rationale ${i}`,
    ...overrides,
  };
}

describe("flattenChannels", () => {
  it("produces columns for every rank up to max, blank tail when short", () => {
    const flat = flattenChannels([mk(1), mk(2), mk(3)]);
    // First three have data
    expect(flat.channel_1_value).toBe("val1");
    expect(flat.channel_2_value).toBe("val2");
    expect(flat.channel_3_value).toBe("val3");
    // Tail columns are blank but PRESENT (stable schema)
    expect(flat.channel_4_value).toBe("");
    expect(flat.channel_5_value).toBe("");
    expect(flat.channel_4_type).toBe("");
  });

  it("includes raw JSON blob when channels exist", () => {
    const flat = flattenChannels([mk(1)]);
    expect(flat.channels_json).not.toBe("");
    const parsed = JSON.parse(flat.channels_json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].value).toBe("val1");
  });

  it("channels_json is empty string when no channels", () => {
    const flat = flattenChannels([]);
    expect(flat.channels_json).toBe("");
  });

  it("truncates overflow channels from flat columns but keeps them in JSON", () => {
    const channels = Array.from({ length: DEFAULT_MAX_FLATTENED_CHANNELS + 2 }, (_, i) => mk(i + 1));
    const flat = flattenChannels(channels);
    const parsed = JSON.parse(flat.channels_json);
    expect(parsed).toHaveLength(DEFAULT_MAX_FLATTENED_CHANNELS + 2);
    // Last flat column is the 5th channel, 6th and 7th live only in JSON
    expect(flat[`channel_${DEFAULT_MAX_FLATTENED_CHANNELS}_value`]).toBe(`val${DEFAULT_MAX_FLATTENED_CHANNELS}`);
  });

  it("header list is stable and includes channels_json last", () => {
    const headers = flattenedChannelHeaders(2);
    const suffixes = ["type", "scope", "value", "url", "score", "status", "compliance", "compliance_note", "first_line", "rank_rationale"];
    for (const s of suffixes) {
      expect(headers).toContain(`channel_1_${s}`);
      expect(headers).toContain(`channel_2_${s}`);
    }
    expect(headers[headers.length - 1]).toBe("channels_json");
  });

  it("respects custom maxChannels argument", () => {
    const flat = flattenChannels([mk(1), mk(2), mk(3)], 1);
    expect(flat.channel_1_value).toBe("val1");
    expect(flat.channel_2_value).toBeUndefined();
  });
});

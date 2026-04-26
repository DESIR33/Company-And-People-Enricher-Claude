import { describe, expect, it } from "vitest";
import { earliestNotBefore } from "./ct-logs";

describe("earliestNotBefore", () => {
  it("returns the earliest not_before across a list of certs", () => {
    const result = earliestNotBefore([
      { notBefore: "2024-06-01T00:00:00" },
      { notBefore: "2022-03-15T00:00:00" },
      { notBefore: "2023-11-01T00:00:00" },
    ]);
    expect(result).toBe("2022-03-15T00:00:00");
  });

  it("ignores certs missing not_before", () => {
    const result = earliestNotBefore([
      { commonName: "x.example.com" },
      { notBefore: "2023-01-01T00:00:00" },
    ]);
    expect(result).toBe("2023-01-01T00:00:00");
  });

  it("ignores unparseable not_before values", () => {
    const result = earliestNotBefore([
      { notBefore: "garbage" },
      { notBefore: "2023-05-01T00:00:00" },
    ]);
    expect(result).toBe("2023-05-01T00:00:00");
  });

  it("returns undefined for empty input", () => {
    expect(earliestNotBefore([])).toBeUndefined();
  });

  it("returns undefined when every cert lacks a parseable date", () => {
    expect(
      earliestNotBefore([{ notBefore: "??" }, { commonName: "x" }])
    ).toBeUndefined();
  });
});

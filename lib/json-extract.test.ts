import { describe, it, expect } from "vitest";
import { extractFirstJsonObject } from "./json-extract";

describe("extractFirstJsonObject", () => {
  it("returns the input when it's already a clean object", () => {
    expect(extractFirstJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it("ignores prose around the object", () => {
    expect(extractFirstJsonObject('Here you go: {"a":1} thanks!')).toBe('{"a":1}');
  });

  it("balances nested objects and arrays", () => {
    const json = '{"companies":[{"name":"X"},{"name":"Y"}]}';
    expect(extractFirstJsonObject(`prose ${json} trailer`)).toBe(json);
  });

  it("ignores braces inside string literals", () => {
    const json = '{"note":"contains } brace","ok":true}';
    expect(extractFirstJsonObject(`prose ${json}`)).toBe(json);
  });

  it("handles escaped quotes in strings", () => {
    const json = '{"q":"she said \\"hi\\"","n":1}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });

  it("returns the FIRST balanced object when multiple appear", () => {
    expect(extractFirstJsonObject('first {"a":1} then {"b":2}')).toBe('{"a":1}');
  });

  it("returns undefined when no balanced object exists", () => {
    expect(extractFirstJsonObject("no json here")).toBeUndefined();
    expect(extractFirstJsonObject('{"unclosed":')).toBeUndefined();
  });

  it("ignores stray closing braces before the object", () => {
    expect(extractFirstJsonObject('}}} {"a":1}')).toBe('{"a":1}');
  });
});

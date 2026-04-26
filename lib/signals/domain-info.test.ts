import { describe, expect, it } from "vitest";
import { isoToEpochMs, parseRdapResponse } from "./domain-info";

describe("parseRdapResponse", () => {
  it("extracts registration / last-changed / expiration dates", () => {
    const out = parseRdapResponse({
      events: [
        { eventAction: "registration", eventDate: "2018-05-14T10:00:00Z" },
        { eventAction: "last changed", eventDate: "2024-05-14T10:00:00Z" },
        { eventAction: "expiration", eventDate: "2026-05-14T10:00:00Z" },
        { eventAction: "last update of RDAP database", eventDate: "2025-01-01T00:00:00Z" },
      ],
    });
    expect(out.createdAt).toBe("2018-05-14T10:00:00Z");
    expect(out.updatedAt).toBe("2024-05-14T10:00:00Z");
    expect(out.expiresAt).toBe("2026-05-14T10:00:00Z");
  });

  it("falls back to RDAP-database-update when 'last changed' is missing", () => {
    const out = parseRdapResponse({
      events: [
        { eventAction: "registration", eventDate: "2020-01-01T00:00:00Z" },
        { eventAction: "last update of RDAP database", eventDate: "2025-01-01T00:00:00Z" },
      ],
    });
    expect(out.updatedAt).toBe("2025-01-01T00:00:00Z");
  });

  it("extracts the registrar name from the vcard fn field", () => {
    const out = parseRdapResponse({
      entities: [
        {
          roles: ["registrar"],
          vcardArray: [
            "vcard",
            [
              ["version", {}, "text", "4.0"],
              ["fn", {}, "text", "GoDaddy.com, LLC"],
              ["adr", {}, "text", "..."],
            ],
          ],
        },
      ],
    });
    expect(out.registrar).toBe("GoDaddy.com, LLC");
  });

  it("ignores entities that don't have the 'registrar' role", () => {
    const out = parseRdapResponse({
      entities: [
        {
          roles: ["technical"],
          vcardArray: [
            "vcard",
            [["fn", {}, "text", "Some Tech Contact"]],
          ],
        },
      ],
    });
    expect(out.registrar).toBeUndefined();
  });

  it("returns an empty object for empty input", () => {
    expect(parseRdapResponse({})).toEqual({});
  });

  it("ignores events without dates", () => {
    const out = parseRdapResponse({
      events: [
        { eventAction: "registration" }, // no eventDate
        { eventDate: "2020-01-01T00:00:00Z" }, // no eventAction
      ],
    });
    expect(out.createdAt).toBeUndefined();
  });
});

describe("isoToEpochMs", () => {
  it("parses ISO 8601 strings", () => {
    expect(isoToEpochMs("2018-05-14T10:00:00Z")).toBe(
      Date.parse("2018-05-14T10:00:00Z")
    );
  });

  it("returns undefined for missing input", () => {
    expect(isoToEpochMs()).toBeUndefined();
    expect(isoToEpochMs(undefined)).toBeUndefined();
  });

  it("returns undefined for unparseable strings", () => {
    expect(isoToEpochMs("not a date")).toBeUndefined();
  });
});

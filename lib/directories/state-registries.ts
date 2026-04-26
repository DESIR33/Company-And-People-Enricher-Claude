// Per-state URL templates for two free SMB-discovery sources:
//
//   1. State Secretary-of-State business filings — every LLC/Inc registered
//      in a state. Filtering by formation date catches "newly opened"
//      businesses; filtering by NAICS narrows to a vertical.
//   2. State contractor-license boards — newly issued or renewed licenses
//      for plumbers, electricians, HVAC, roofers, general contractors.
//
// These are scraped via Firecrawl. Some states gate the data behind a CAPTCHA
// or POST-only search form — those are flagged with `needsCaptcha: true` and
// the runner will skip them or fall back to a Google site:state.gov query.
//
// Coverage starts with the five largest US states by SMB count: CA, TX, FL,
// NY, GA. Adding a state = appending an entry; the runner drives the rest.

export type StateScope = "CA" | "TX" | "FL" | "NY" | "GA";

export type StateRegistryEntry = {
  state: StateScope;
  // Used for prompt context only.
  stateName: string;
  // Secretary-of-State new-filings search.
  sos: {
    searchUrl: string;
    needsCaptcha?: boolean;
    notes: string;
  };
  // Contractor-license board (or unified DBPR/DLLR equivalent).
  licenseBoard: {
    searchUrl: string;
    boardName: string;
    needsCaptcha?: boolean;
    licenseTypes: string[];
    notes: string;
  };
};

export const STATE_REGISTRIES: Record<StateScope, StateRegistryEntry> = {
  CA: {
    state: "CA",
    stateName: "California",
    sos: {
      searchUrl: "https://bizfileonline.sos.ca.gov/search/business",
      needsCaptcha: true,
      notes:
        "California's BizFile Online search requires JS + CAPTCHA. Best-effort: fall back to `site:bizfileonline.sos.ca.gov \"<keyword>\"` Google query, or scrape the open data dump at data.ca.gov.",
    },
    licenseBoard: {
      searchUrl:
        "https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/CheckLicense.aspx",
      boardName: "Contractors State License Board (CSLB)",
      licenseTypes: [
        "general contractor",
        "plumbing",
        "electrical",
        "HVAC",
        "roofing",
        "painting",
        "landscape",
      ],
      notes:
        "CSLB exposes a per-license search; bulk newly-issued can be fetched via the CSLB monthly extract at https://www.cslb.ca.gov/About_Us/Library/Data_Downloads.aspx (ZIP of CSV).",
    },
  },
  TX: {
    state: "TX",
    stateName: "Texas",
    sos: {
      searchUrl: "https://mycpa.cpa.state.tx.us/coa/",
      notes:
        "Texas Comptroller's franchise tax search returns active entities. New formations also surface on https://corp.sos.state.tx.us — but that requires login. Fall back to `site:gov.texas.gov \"<keyword>\" \"new business\"`.",
    },
    licenseBoard: {
      searchUrl: "https://www.tdlr.texas.gov/LicenseSearch/",
      boardName: "Texas Department of Licensing & Regulation (TDLR)",
      licenseTypes: [
        "electrician",
        "plumber",
        "HVAC",
        "boiler",
        "elevator",
        "tow truck",
      ],
      notes:
        "TDLR has a public license search and a monthly newly-issued list. Roofing in TX is unlicensed at the state level; check city permit databases instead.",
    },
  },
  FL: {
    state: "FL",
    stateName: "Florida",
    sos: {
      searchUrl: "https://search.sunbiz.org/Inquiry/CorporationSearch/ByName",
      notes:
        "Sunbiz is the Florida corp registry. Search by date filed range works (`Filing date` filter) — scrape the listing pages for newly registered entities.",
    },
    licenseBoard: {
      searchUrl: "https://www.myfloridalicense.com/wl11.asp",
      boardName: "Florida DBPR",
      licenseTypes: [
        "general contractor",
        "plumbing",
        "electrical",
        "HVAC",
        "roofing",
        "pool",
        "real estate",
      ],
      notes:
        "DBPR's License Search returns active license holders; a Newly Issued list is published at https://www2.myfloridalicense.com/wl11.asp?mode=2 by date.",
    },
  },
  NY: {
    state: "NY",
    stateName: "New York",
    sos: {
      searchUrl:
        "https://apps.dos.ny.gov/publicInquiry/EntitySearch",
      notes:
        "New York DOS Entity Search supports name + date-filed search. Bulk new-formation data is available via the open data portal at https://data.ny.gov.",
    },
    licenseBoard: {
      searchUrl: "https://www.dos.ny.gov/licensing/license_search.html",
      boardName: "NY Department of State — Licensing Services",
      licenseTypes: [
        "home improvement contractor",
        "real estate broker",
        "real estate salesperson",
        "appearance enhancement",
        "security guard",
      ],
      notes:
        "Trades are regulated city-by-city in NY (NYC DOB for plumbers/electricians). Use NYC Open Data (https://data.cityofnewyork.us) for newly-licensed plumbers/electricians.",
    },
  },
  GA: {
    state: "GA",
    stateName: "Georgia",
    sos: {
      searchUrl:
        "https://ecorp.sos.ga.gov/BusinessSearch",
      notes:
        "Georgia eCorp business search returns active entities. New formations searchable by date and county. Bulk dump is not freely available — agent must scrape paginated results.",
    },
    licenseBoard: {
      searchUrl:
        "https://verify.sos.ga.gov/verification/Search.aspx",
      boardName: "Georgia Secretary of State Professional Licensing Division",
      licenseTypes: [
        "general contractor",
        "electrical contractor",
        "low voltage",
        "plumbing",
        "conditioned air",
        "real estate",
      ],
      notes:
        "PLB's verification search returns license holders one at a time; for a date-bounded sweep the agent has to enumerate by name pattern. Newly-issued bulk data is on georgia.gov open data.",
    },
  },
};

export function getStateRegistry(state: string): StateRegistryEntry | undefined {
  const upper = state.trim().toUpperCase() as StateScope;
  return STATE_REGISTRIES[upper];
}

export function listStates(): StateScope[] {
  return Object.keys(STATE_REGISTRIES) as StateScope[];
}

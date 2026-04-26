import { discoverCompanies, type SignalAgentConfig } from "./discovery-agent";
import {
  appendDiscoveryLog,
  clearSearchAbort,
  createSearch,
  getSearch,
  insertLead,
  setSearchAbort,
  updateSearch,
  type DirectoryConfig,
  type DiscoveredLead,
  type DiscoveryMode,
  type DirectorySource,
} from "./discovery-store";
import { capStatus, getCurrentUsage, recordUsage } from "./usage-store";
import * as firecrawl from "./firecrawl";
import {
  osmBusinessToLeadInput,
  queryOsmArea,
  queryOsmRadius,
} from "./directories/osm-overpass";
import {
  googlePlaceToLeadInput,
  searchPlacesByText,
  searchPlacesNearby,
  type GooglePlace,
} from "./directories/google-places";
import {
  foursquarePlaceToLeadInput,
  searchFoursquareNear,
  searchFoursquareRadius,
  type FoursquarePlace,
} from "./directories/foursquare";
import {
  bingPlaceToLeadInput,
  searchBingLocal,
  type BingPlace,
} from "./directories/bing-places";
import {
  searchTomTomRadius,
  tomtomPlaceToLeadInput,
  type TomTomPlace,
} from "./directories/tomtom";
import {
  herePlaceToLeadInput,
  searchHerePlaces,
  type HerePlace,
} from "./directories/here-places";
import {
  genericItemToLead,
  getApifyPreset,
  type ApifyLeadInput,
} from "./directories/apify-actors";
import { runActorAndGetItems } from "./scrapers/apify";
import {
  searchYelpDirect,
  yelpDirectToLeadInput,
} from "./directories/yelp-direct";
import {
  bbbDirectToLeadInput,
  searchBbbDirect,
} from "./directories/bbb-direct";
import { getStateRegistry } from "./directories/state-registries";
import { expandZipsForRadius, lookupZip, parseGeoString } from "./geo";
import { dedupeById, suggestedTileMiles, tilesForRadius } from "./geo-fan";

export type StartSearchResult =
  | { status: "started"; searchId: string }
  | { status: "cap_exceeded"; reason: string };

export async function executeSearch(
  searchId: string,
  opts: { signalConfig?: SignalAgentConfig } = {}
): Promise<void> {
  const init = getSearch(searchId);
  if (!init) return;

  const abort = new AbortController();
  setSearchAbort(searchId, abort);

  const startedAt = Date.now();
  updateSearch(searchId, { status: "running", startedAt });
  appendDiscoveryLog(searchId, `Search started (mode=${init.mode})`);

  let totalCost = 0;
  let discoveredCount = 0;
  const insertedLeads: DiscoveredLead[] = [];

  try {
    // ----- Direct API path: OSM Overpass --------------------------------
    // OSM data is free and structured. When the user picks osm_overpass we
    // bypass the agent entirely — Overpass returns clean JSON that we
    // convert directly to lead inserts. This is the cheapest, most
    // deterministic discovery path in the system.
    if (
      init.mode === "directory" &&
      init.directoryConfig?.source === "osm_overpass"
    ) {
      const osmCount = await runOsmOverpassDirect(
        init.directoryConfig,
        init.maxResults,
        searchId,
        abort.signal,
        (line) => appendDiscoveryLog(searchId, line),
        (lead) => insertedLeads.push(lead)
      );
      discoveredCount = osmCount;
      const completedAt = Date.now();
      const status = abort.signal.aborted ? "cancelled" : "completed";
      updateSearch(searchId, {
        status,
        completedAt,
        discoveredCount,
        costUsd: totalCost,
        agentNote: `OSM Overpass returned ${osmCount} business(es).`,
      });
      appendDiscoveryLog(
        searchId,
        `Search ${status}: ${osmCount} OSM businesses, $0.00 (free API)`
      );
      await maybeDeliverWebhook(init.webhookUrl, searchId, insertedLeads, (line) =>
        appendDiscoveryLog(searchId, line)
      );
      return;
    }

    // ----- Direct API path: Google Places (New) -------------------------
    // Same idea as OSM but uses Google's structured JSON. We fan a single
    // radius query out into a tile grid because Nearby Search caps at 20
    // results per call — without tiling, dense metros get truncated.
    if (
      init.mode === "directory" &&
      init.directoryConfig?.source === "google_places"
    ) {
      const count = await runGooglePlacesDirect(
        init.directoryConfig,
        init.maxResults,
        searchId,
        abort.signal,
        (line) => appendDiscoveryLog(searchId, line),
        (lead) => insertedLeads.push(lead)
      );
      discoveredCount = count;
      const completedAt = Date.now();
      const status = abort.signal.aborted ? "cancelled" : "completed";
      updateSearch(searchId, {
        status,
        completedAt,
        discoveredCount,
        costUsd: totalCost,
        agentNote: `Google Places returned ${count} business(es).`,
      });
      appendDiscoveryLog(
        searchId,
        `Search ${status}: ${count} Google Places businesses (Google quota only)`
      );
      await maybeDeliverWebhook(init.webhookUrl, searchId, insertedLeads, (line) =>
        appendDiscoveryLog(searchId, line)
      );
      return;
    }

    // ----- Direct API path: Yelp via Playwright -------------------------
    // Self-hosted scraper. Requires `npm install playwright` + a browser
    // download on the host. Falls through to the agent-driven `yelp` source
    // if the install isn't present (the runner reports it via log).
    if (
      init.mode === "directory" &&
      init.directoryConfig?.source === "yelp_direct"
    ) {
      const count = await runYelpDirect(
        init.directoryConfig,
        init.maxResults,
        searchId,
        abort.signal,
        (line) => appendDiscoveryLog(searchId, line),
        (lead) => insertedLeads.push(lead)
      );
      discoveredCount = count;
      const completedAt = Date.now();
      const status = abort.signal.aborted ? "cancelled" : "completed";
      updateSearch(searchId, {
        status,
        completedAt,
        discoveredCount,
        costUsd: totalCost,
        agentNote: `Yelp (Playwright) returned ${count} business(es).`,
      });
      appendDiscoveryLog(
        searchId,
        `Search ${status}: ${count} Yelp businesses (Playwright direct)`
      );
      await maybeDeliverWebhook(init.webhookUrl, searchId, insertedLeads, (line) =>
        appendDiscoveryLog(searchId, line)
      );
      return;
    }

    // ----- Direct API path: BBB via Playwright --------------------------
    // Self-hosted scraper. BBB is a high-signal SMB directory: every
    // listing is verified, accredited businesses score higher, A-F
    // letter rating + years in business surface in matchReason.
    if (
      init.mode === "directory" &&
      init.directoryConfig?.source === "bbb_direct"
    ) {
      const count = await runBbbDirect(
        init.directoryConfig,
        init.maxResults,
        searchId,
        abort.signal,
        (line) => appendDiscoveryLog(searchId, line),
        (lead) => insertedLeads.push(lead)
      );
      discoveredCount = count;
      const completedAt = Date.now();
      const status = abort.signal.aborted ? "cancelled" : "completed";
      updateSearch(searchId, {
        status,
        completedAt,
        discoveredCount,
        costUsd: totalCost,
        agentNote: `BBB (Playwright) returned ${count} business(es).`,
      });
      appendDiscoveryLog(
        searchId,
        `Search ${status}: ${count} BBB businesses (Playwright direct)`
      );
      await maybeDeliverWebhook(init.webhookUrl, searchId, insertedLeads, (line) =>
        appendDiscoveryLog(searchId, line)
      );
      return;
    }

    // ----- Direct API path: Apify (LinkedIn / Glassdoor / Yelp / etc.) ---
    // Apify wraps the directories that block direct fetches. The runner
    // selects an actor via cfg.actorId (preset key or raw `user/actor`),
    // builds the actor input from the directoryConfig, runs it, and maps
    // returned dataset items to leads.
    if (
      init.mode === "directory" &&
      init.directoryConfig?.source === "apify"
    ) {
      const result = await runApifyDirect(
        init.directoryConfig,
        init.maxResults,
        searchId,
        abort.signal,
        (line) => appendDiscoveryLog(searchId, line),
        (lead) => insertedLeads.push(lead)
      );
      discoveredCount = result.count;
      totalCost += result.costUsd;
      const completedAt = Date.now();
      const status = abort.signal.aborted ? "cancelled" : "completed";
      updateSearch(searchId, {
        status,
        completedAt,
        discoveredCount,
        costUsd: totalCost,
        agentNote: `Apify actor returned ${result.count} business(es).`,
      });
      if (totalCost > 0) recordUsage(0, totalCost);
      appendDiscoveryLog(
        searchId,
        `Search ${status}: ${result.count} Apify items, $${totalCost.toFixed(4)}`
      );
      await maybeDeliverWebhook(init.webhookUrl, searchId, insertedLeads, (line) =>
        appendDiscoveryLog(searchId, line)
      );
      return;
    }

    // ----- Direct API path: TomTom Search -------------------------------
    if (
      init.mode === "directory" &&
      init.directoryConfig?.source === "tomtom"
    ) {
      const count = await runTomTomDirect(
        init.directoryConfig,
        init.maxResults,
        searchId,
        abort.signal,
        (line) => appendDiscoveryLog(searchId, line),
        (lead) => insertedLeads.push(lead)
      );
      discoveredCount = count;
      const completedAt = Date.now();
      const status = abort.signal.aborted ? "cancelled" : "completed";
      updateSearch(searchId, {
        status,
        completedAt,
        discoveredCount,
        costUsd: totalCost,
        agentNote: `TomTom Search returned ${count} business(es).`,
      });
      appendDiscoveryLog(
        searchId,
        `Search ${status}: ${count} TomTom businesses (TomTom quota only)`
      );
      await maybeDeliverWebhook(init.webhookUrl, searchId, insertedLeads, (line) =>
        appendDiscoveryLog(searchId, line)
      );
      return;
    }

    // ----- Direct API path: HERE Discover -------------------------------
    if (
      init.mode === "directory" &&
      init.directoryConfig?.source === "here_places"
    ) {
      const count = await runHereDirect(
        init.directoryConfig,
        init.maxResults,
        searchId,
        abort.signal,
        (line) => appendDiscoveryLog(searchId, line),
        (lead) => insertedLeads.push(lead)
      );
      discoveredCount = count;
      const completedAt = Date.now();
      const status = abort.signal.aborted ? "cancelled" : "completed";
      updateSearch(searchId, {
        status,
        completedAt,
        discoveredCount,
        costUsd: totalCost,
        agentNote: `HERE returned ${count} business(es).`,
      });
      appendDiscoveryLog(
        searchId,
        `Search ${status}: ${count} HERE businesses (HERE quota only)`
      );
      await maybeDeliverWebhook(init.webhookUrl, searchId, insertedLeads, (line) =>
        appendDiscoveryLog(searchId, line)
      );
      return;
    }

    // ----- Direct API path: Bing Local Search ---------------------------
    if (
      init.mode === "directory" &&
      init.directoryConfig?.source === "bing_places"
    ) {
      const count = await runBingPlacesDirect(
        init.directoryConfig,
        init.maxResults,
        searchId,
        abort.signal,
        (line) => appendDiscoveryLog(searchId, line),
        (lead) => insertedLeads.push(lead)
      );
      discoveredCount = count;
      const completedAt = Date.now();
      const status = abort.signal.aborted ? "cancelled" : "completed";
      updateSearch(searchId, {
        status,
        completedAt,
        discoveredCount,
        costUsd: totalCost,
        agentNote: `Bing Local Search returned ${count} business(es).`,
      });
      appendDiscoveryLog(
        searchId,
        `Search ${status}: ${count} Bing businesses (Bing quota only)`
      );
      await maybeDeliverWebhook(init.webhookUrl, searchId, insertedLeads, (line) =>
        appendDiscoveryLog(searchId, line)
      );
      return;
    }

    // ----- Direct API path: Foursquare Places ---------------------------
    if (
      init.mode === "directory" &&
      init.directoryConfig?.source === "foursquare"
    ) {
      const count = await runFoursquareDirect(
        init.directoryConfig,
        init.maxResults,
        searchId,
        abort.signal,
        (line) => appendDiscoveryLog(searchId, line),
        (lead) => insertedLeads.push(lead)
      );
      discoveredCount = count;
      const completedAt = Date.now();
      const status = abort.signal.aborted ? "cancelled" : "completed";
      updateSearch(searchId, {
        status,
        completedAt,
        discoveredCount,
        costUsd: totalCost,
        agentNote: `Foursquare returned ${count} business(es).`,
      });
      appendDiscoveryLog(
        searchId,
        `Search ${status}: ${count} Foursquare businesses (Foursquare quota only)`
      );
      await maybeDeliverWebhook(init.webhookUrl, searchId, insertedLeads, (line) =>
        appendDiscoveryLog(searchId, line)
      );
      return;
    }

    // ----- Agent-driven path (every other source/mode) ------------------
    const preFetch = await firecrawlPreFetch(init, abort.signal, (line) =>
      appendDiscoveryLog(searchId, line)
    );
    totalCost += preFetch.costUsd;
    if (preFetch.costUsd > 0) {
      appendDiscoveryLog(
        searchId,
        `Firecrawl pre-fetch spent ${preFetch.credits} credit(s) ≈ $${preFetch.costUsd.toFixed(4)}`
      );
    }

    const result = await discoverCompanies({
      mode: init.mode,
      queryText: init.queryText,
      seedCompanies: init.seedCompanies,
      signalConfig: opts.signalConfig,
      directoryConfig: init.directoryConfig,
      preFetched: preFetch.content,
      maxResults: init.maxResults,
      signal: abort.signal,
      onLog: (line) => appendDiscoveryLog(searchId, line),
    });
    totalCost += result.costUsd;

    for (const c of result.companies) {
      if (abort.signal.aborted) break;
      const { lead, isNew } = insertLead({
        searchId,
        companyName: c.companyName,
        websiteUrl: c.websiteUrl,
        linkedinUrl: c.linkedinUrl,
        description: c.description,
        location: c.location,
        industry: c.industry,
        employeeRange: c.employeeRange,
        matchReason: c.matchReason,
        sourceUrl: c.sourceUrl,
        score: c.score,
        phone: c.phone,
        streetAddress: c.streetAddress,
        city: c.city,
        region: c.region,
        postalCode: c.postalCode,
        countryCode: c.countryCode,
        lat: c.lat,
        lng: c.lng,
        placeId: c.placeId,
        hours: c.hours,
        naicsCode: c.naicsCode,
        licenseNumber: c.licenseNumber,
      });
      if (isNew) {
        insertedLeads.push(lead);
        discoveredCount += 1;
      }
    }

    const completedAt = Date.now();
    const status = abort.signal.aborted ? "cancelled" : "completed";
    updateSearch(searchId, {
      status,
      completedAt,
      discoveredCount,
      costUsd: totalCost,
      agentNote: result.note,
    });
    if (totalCost > 0) recordUsage(0, totalCost);

    appendDiscoveryLog(
      searchId,
      `Search ${status}: ${discoveredCount} candidate(s), $${totalCost.toFixed(4)}`
    );

    await maybeDeliverWebhook(init.webhookUrl, searchId, insertedLeads, (line) =>
      appendDiscoveryLog(searchId, line)
    );
  } catch (err) {
    updateSearch(searchId, {
      status: "failed",
      error: String(err),
      completedAt: Date.now(),
      costUsd: totalCost,
      discoveredCount,
    });
    appendDiscoveryLog(searchId, `Search failed: ${String(err)}`);
  } finally {
    clearSearchAbort(searchId);
  }
}

// --- OSM Overpass direct path ---------------------------------------------
// Uses the free Overpass API (no key, no Firecrawl) to pull businesses
// matching a category inside a radius or named area, then converts each one
// to a lead row. Returns the number of leads inserted.
async function runOsmOverpassDirect(
  cfg: DirectoryConfig,
  maxResults: number,
  searchId: string,
  signal: AbortSignal,
  log: (line: string) => void,
  onInsert: (lead: DiscoveredLead) => void
): Promise<number> {
  const category = cfg.category ?? cfg.query ?? "";
  if (!category) {
    log(`OSM Overpass: no category supplied`);
    return 0;
  }

  // Resolve geo. Priority: lat/lng + radius → zip → MSA → city/state.
  let lat = cfg.lat;
  let lng = cfg.lng;
  const radius = cfg.radiusMiles ?? 10;
  let geoLabel = cfg.geo;

  if ((lat === undefined || lng === undefined) && cfg.geo) {
    const parsed = parseGeoString(cfg.geo);
    if (parsed.kind === "zip" || parsed.kind === "latlng") {
      lat = parsed.lat;
      lng = parsed.lng;
      if (parsed.kind === "zip") geoLabel = `${parsed.city}, ${parsed.state} ${parsed.zip}`;
    }
  }
  if ((lat === undefined || lng === undefined) && cfg.zips?.length) {
    const rec = lookupZip(cfg.zips[0]);
    if (rec) {
      lat = rec.lat;
      lng = rec.lng;
      geoLabel = `${rec.city}, ${rec.state} ${rec.zip}`;
    }
  }

  let businesses: Awaited<ReturnType<typeof queryOsmRadius>> = [];

  if (lat !== undefined && lng !== undefined) {
    log(`OSM Overpass: querying "${category}" within ${radius} mi of ${lat.toFixed(4)},${lng.toFixed(4)}`);
    try {
      businesses = await queryOsmRadius({
        lat,
        lng,
        radiusMiles: radius,
        category,
        signal,
      });
    } catch (err) {
      log(`OSM Overpass radius query failed: ${String(err)}`);
    }
  } else if (cfg.geo) {
    // Fallback to area search when no lat/lng available.
    log(`OSM Overpass: querying "${category}" inside area "${cfg.geo}"`);
    try {
      businesses = await queryOsmArea({
        areaName: cfg.geo,
        category,
        signal,
      });
    } catch (err) {
      log(`OSM Overpass area query failed: ${String(err)}`);
    }
  } else {
    log(`OSM Overpass: no geo provided — Overpass requires either lat/lng+radius or an area name`);
    return 0;
  }

  if (businesses.length === 0) {
    log(`OSM Overpass: 0 results — try a different category preset or widen the radius`);
    return 0;
  }
  log(`OSM Overpass: ${businesses.length} candidate(s) before dedup, taking up to ${maxResults}`);

  let inserted = 0;
  for (const b of businesses.slice(0, maxResults)) {
    if (signal.aborted) break;
    const input = osmBusinessToLeadInput(b, searchId, category, geoLabel);
    const { lead, isNew } = insertLead(input);
    if (isNew) {
      inserted += 1;
      onInsert(lead);
    }
  }
  log(`OSM Overpass: inserted ${inserted} new lead(s)`);
  return inserted;
}

// --- Google Places direct path --------------------------------------------
// Uses the new Places API. Two modes:
//   - Nearby: lat/lng + radius + category preset → fans out across a tile
//     grid because Nearby Search hard-caps at 20 results per call.
//   - Text:   free-text query, optionally biased to a circle. Returns up
//     to 60 results across paginated pages.
//
// Picks Nearby when both a category preset and a center point are present;
// otherwise falls back to Text Search. Tile fan-out caps at 25 tiles to
// keep quota use predictable.
async function runGooglePlacesDirect(
  cfg: DirectoryConfig,
  maxResults: number,
  searchId: string,
  signal: AbortSignal,
  log: (line: string) => void,
  onInsert: (lead: DiscoveredLead) => void
): Promise<number> {
  const category = cfg.category ?? cfg.query;
  const queryText = cfg.query ?? cfg.category;

  const { lat, lng, geoLabel } = resolveLatLng(cfg);

  const radiusMiles = cfg.radiusMiles ?? 10;
  let results: GooglePlace[] = [];

  try {
    if (lat !== undefined && lng !== undefined && category) {
      const tileMiles = suggestedTileMiles("google_places", "med");
      const tiles = tilesForRadius(lat, lng, radiusMiles, tileMiles, { maxTiles: 25 });
      log(
        `Google Places: ${tiles.length} tile(s) of ~${tileMiles}mi covering ${radiusMiles}mi around ${lat.toFixed(4)},${lng.toFixed(4)}`
      );
      const collected: GooglePlace[] = [];
      for (const tile of tiles) {
        if (signal.aborted) break;
        if (collected.length >= maxResults) break;
        try {
          const batch = await searchPlacesNearby({
            lat: tile.lat,
            lng: tile.lng,
            radiusMiles: tile.radiusMiles,
            category,
            maxResults: 20,
            signal,
          });
          collected.push(...batch);
        } catch (err) {
          log(`Google Places tile failed: ${String(err)}`);
        }
      }
      results = dedupeById(collected, (p) => p.placeId);
    } else if (queryText) {
      log(
        `Google Places: text search "${queryText}"${
          lat !== undefined && lng !== undefined ? ` biased near ${lat},${lng}` : ""
        }`
      );
      results = await searchPlacesByText({
        query: queryText,
        lat,
        lng,
        radiusMiles: lat !== undefined && lng !== undefined ? radiusMiles : undefined,
        category,
        maxResults: Math.min(maxResults, 60),
        signal,
      });
    } else {
      log(`Google Places: missing query and category — nothing to search`);
      return 0;
    }
  } catch (err) {
    log(`Google Places query failed: ${String(err)}`);
    return 0;
  }

  if (results.length === 0) {
    log(`Google Places: 0 results — try widening the radius or using free-text query`);
    return 0;
  }
  log(`Google Places: ${results.length} candidate(s) before dedup, taking up to ${maxResults}`);

  let inserted = 0;
  for (const p of results.slice(0, maxResults)) {
    if (signal.aborted) break;
    const input = googlePlaceToLeadInput(p, searchId, category, geoLabel);
    const { lead, isNew } = insertLead(input);
    if (isNew) {
      inserted += 1;
      onInsert(lead);
    }
  }
  log(`Google Places: inserted ${inserted} new lead(s)`);
  return inserted;
}

// --- Foursquare direct path -----------------------------------------------
// Foursquare's circle search caps at 100km radius and 50 results per page,
// but supports cursor pagination so a single radius call can sweep deeper
// than Google's Nearby. We still fan a wide radius into tiles when the
// caller asks for >25 mi to keep dense-metro coverage usable.
async function runFoursquareDirect(
  cfg: DirectoryConfig,
  maxResults: number,
  searchId: string,
  signal: AbortSignal,
  log: (line: string) => void,
  onInsert: (lead: DiscoveredLead) => void
): Promise<number> {
  const category = cfg.category;
  const query = cfg.query;

  const { lat, lng, geoLabel } = resolveLatLng(cfg);

  const radiusMiles = cfg.radiusMiles ?? 10;
  let results: FoursquarePlace[] = [];

  try {
    if (lat !== undefined && lng !== undefined) {
      // Single call when the radius is small enough; tile when it's large.
      if (radiusMiles <= 25) {
        log(
          `Foursquare: radius search ${radiusMiles}mi around ${lat.toFixed(4)},${lng.toFixed(4)}`
        );
        results = await searchFoursquareRadius({
          lat,
          lng,
          radiusMiles,
          category,
          query,
          maxResults,
          signal,
        });
      } else {
        const tileMiles = suggestedTileMiles("foursquare", "med");
        const tiles = tilesForRadius(lat, lng, radiusMiles, tileMiles, { maxTiles: 25 });
        log(
          `Foursquare: ${tiles.length} tile(s) of ~${tileMiles}mi covering ${radiusMiles}mi around ${lat.toFixed(4)},${lng.toFixed(4)}`
        );
        const collected: FoursquarePlace[] = [];
        for (const tile of tiles) {
          if (signal.aborted) break;
          if (collected.length >= maxResults) break;
          try {
            const batch = await searchFoursquareRadius({
              lat: tile.lat,
              lng: tile.lng,
              radiusMiles: tile.radiusMiles,
              category,
              query,
              maxResults: 50,
              signal,
            });
            collected.push(...batch);
          } catch (err) {
            log(`Foursquare tile failed: ${String(err)}`);
          }
        }
        results = dedupeById(collected, (p) => p.fsqId);
      }
    } else if (cfg.geo) {
      log(`Foursquare: near "${cfg.geo}"`);
      results = await searchFoursquareNear({
        near: cfg.geo,
        category,
        query,
        maxResults,
        signal,
      });
    } else {
      log(`Foursquare: missing geo — supply lat/lng, zip, or a "near" string`);
      return 0;
    }
  } catch (err) {
    log(`Foursquare query failed: ${String(err)}`);
    return 0;
  }

  if (results.length === 0) {
    log(`Foursquare: 0 results — try a different category or widen the radius`);
    return 0;
  }
  log(`Foursquare: ${results.length} candidate(s) before dedup, taking up to ${maxResults}`);

  let inserted = 0;
  for (const p of results.slice(0, maxResults)) {
    if (signal.aborted) break;
    const input = foursquarePlaceToLeadInput(p, searchId, category, geoLabel);
    const { lead, isNew } = insertLead(input);
    if (isNew) {
      inserted += 1;
      onInsert(lead);
    }
  }
  log(`Foursquare: inserted ${inserted} new lead(s)`);
  return inserted;
}

// --- TomTom Search direct path -------------------------------------------
// TomTom returns up to 100 results per call with a 50km radius cap. We
// tile-fan when the requested radius is larger than ~30 mi, single-call
// otherwise.
async function runTomTomDirect(
  cfg: DirectoryConfig,
  maxResults: number,
  searchId: string,
  signal: AbortSignal,
  log: (line: string) => void,
  onInsert: (lead: DiscoveredLead) => void
): Promise<number> {
  const category = cfg.category;
  const query = cfg.query ?? cfg.category;

  const { lat, lng, geoLabel } = resolveLatLng(cfg);
  if (lat === undefined || lng === undefined) {
    log(`TomTom: missing geo — supply lat/lng, zip, or a parseable city/zip in geo`);
    return 0;
  }

  const radiusMiles = cfg.radiusMiles ?? 10;
  let results: TomTomPlace[];
  try {
    if (radiusMiles <= 30) {
      log(`TomTom: radius search ${radiusMiles}mi around ${lat.toFixed(4)},${lng.toFixed(4)}`);
      results = await searchTomTomRadius({
        lat,
        lng,
        radiusMiles,
        category,
        query,
        maxResults,
        signal,
      });
    } else {
      const tileMiles = suggestedTileMiles("tomtom", "med");
      const tiles = tilesForRadius(lat, lng, radiusMiles, tileMiles, { maxTiles: 25 });
      log(
        `TomTom: ${tiles.length} tile(s) of ~${tileMiles}mi covering ${radiusMiles}mi around ${lat.toFixed(4)},${lng.toFixed(4)}`
      );
      const collected: TomTomPlace[] = [];
      for (const tile of tiles) {
        if (signal.aborted) break;
        if (collected.length >= maxResults) break;
        try {
          const batch = await searchTomTomRadius({
            lat: tile.lat,
            lng: tile.lng,
            radiusMiles: tile.radiusMiles,
            category,
            query,
            maxResults: 100,
            signal,
          });
          collected.push(...batch);
        } catch (err) {
          log(`TomTom tile failed: ${String(err)}`);
        }
      }
      results = dedupeById(collected, (p) => p.ttId);
    }
  } catch (err) {
    log(`TomTom query failed: ${String(err)}`);
    return 0;
  }

  if (results.length === 0) {
    log(`TomTom: 0 results — try a different category or widen the radius`);
    return 0;
  }
  log(`TomTom: ${results.length} candidate(s) before dedup, taking up to ${maxResults}`);

  let inserted = 0;
  for (const p of results.slice(0, maxResults)) {
    if (signal.aborted) break;
    const input = tomtomPlaceToLeadInput(p, searchId, category, geoLabel);
    const { lead, isNew } = insertLead(input);
    if (isNew) {
      inserted += 1;
      onInsert(lead);
    }
  }
  log(`TomTom: inserted ${inserted} new lead(s)`);
  return inserted;
}

// --- HERE Discover direct path -------------------------------------------
// HERE caps at 100 results per call. /browse takes structured category
// IDs (preferred when we have a preset); /discover takes free text. The
// connector picks per-call automatically; the runner just decides
// single-call vs. tile-fan based on requested radius.
async function runHereDirect(
  cfg: DirectoryConfig,
  maxResults: number,
  searchId: string,
  signal: AbortSignal,
  log: (line: string) => void,
  onInsert: (lead: DiscoveredLead) => void
): Promise<number> {
  const category = cfg.category;
  const query = cfg.query ?? cfg.category;

  const { lat, lng, geoLabel } = resolveLatLng(cfg);
  if (lat === undefined || lng === undefined) {
    log(`HERE: missing geo — supply lat/lng, zip, or a parseable city/zip in geo`);
    return 0;
  }

  const radiusMiles = cfg.radiusMiles ?? 10;
  let results: HerePlace[];
  try {
    if (radiusMiles <= 30) {
      log(`HERE: radius search ${radiusMiles}mi around ${lat.toFixed(4)},${lng.toFixed(4)}`);
      results = await searchHerePlaces({
        lat,
        lng,
        radiusMiles,
        category,
        query,
        maxResults,
        signal,
      });
    } else {
      const tileMiles = suggestedTileMiles("here_places", "med");
      const tiles = tilesForRadius(lat, lng, radiusMiles, tileMiles, { maxTiles: 25 });
      log(
        `HERE: ${tiles.length} tile(s) of ~${tileMiles}mi covering ${radiusMiles}mi around ${lat.toFixed(4)},${lng.toFixed(4)}`
      );
      const collected: HerePlace[] = [];
      for (const tile of tiles) {
        if (signal.aborted) break;
        if (collected.length >= maxResults) break;
        try {
          const batch = await searchHerePlaces({
            lat: tile.lat,
            lng: tile.lng,
            radiusMiles: tile.radiusMiles,
            category,
            query,
            maxResults: 100,
            signal,
          });
          collected.push(...batch);
        } catch (err) {
          log(`HERE tile failed: ${String(err)}`);
        }
      }
      results = dedupeById(collected, (p) => p.hereId);
    }
  } catch (err) {
    log(`HERE query failed: ${String(err)}`);
    return 0;
  }

  if (results.length === 0) {
    log(`HERE: 0 results — try a different category or widen the radius`);
    return 0;
  }
  log(`HERE: ${results.length} candidate(s) before dedup, taking up to ${maxResults}`);

  let inserted = 0;
  for (const p of results.slice(0, maxResults)) {
    if (signal.aborted) break;
    const input = herePlaceToLeadInput(p, searchId, category, geoLabel);
    const { lead, isNew } = insertLead(input);
    if (isNew) {
      inserted += 1;
      onInsert(lead);
    }
  }
  log(`HERE: inserted ${inserted} new lead(s)`);
  return inserted;
}

// Lat/lng resolver shared by all native point-anchored sources. Priority:
// explicit cfg.lat/lng, then parsed geo string (zip / "lat,lng" forms),
// then the first zip from cfg.zips. Returns undefined coords when the
// caller didn't supply enough info — the per-source runner logs and
// short-circuits.
function resolveLatLng(cfg: DirectoryConfig): {
  lat?: number;
  lng?: number;
  geoLabel?: string;
} {
  let lat = cfg.lat;
  let lng = cfg.lng;
  let geoLabel = cfg.geo;
  if ((lat === undefined || lng === undefined) && cfg.geo) {
    const parsed = parseGeoString(cfg.geo);
    if (parsed.kind === "zip" || parsed.kind === "latlng") {
      lat = parsed.lat;
      lng = parsed.lng;
      if (parsed.kind === "zip") geoLabel = `${parsed.city}, ${parsed.state} ${parsed.zip}`;
    }
  }
  if ((lat === undefined || lng === undefined) && cfg.zips?.length) {
    const rec = lookupZip(cfg.zips[0]);
    if (rec) {
      lat = rec.lat;
      lng = rec.lng;
      geoLabel = `${rec.city}, ${rec.state} ${rec.zip}`;
    }
  }
  return { lat, lng, geoLabel };
}

// --- Apify direct path ----------------------------------------------------
// Resolves cfg.actorId against the curated preset registry first (which
// brings a typed input builder + lead adapter), and falls back to a
// generic input + heuristic adapter when the user passed a raw
// "username/actor" not in the registry. Cost from the run's
// usageTotalUsd (when present) is rolled into the search's costUsd.
async function runApifyDirect(
  cfg: DirectoryConfig,
  maxResults: number,
  searchId: string,
  signal: AbortSignal,
  log: (line: string) => void,
  onInsert: (lead: DiscoveredLead) => void
): Promise<{ count: number; costUsd: number }> {
  const actorRef = cfg.actorId?.trim();
  if (!actorRef) {
    log(`Apify: missing actorId — pick a preset or paste a "username/actor" ID`);
    return { count: 0, costUsd: 0 };
  }

  const preset = getApifyPreset(actorRef);
  const actorId = preset?.actorId ?? actorRef;
  const inputBuilder =
    preset?.inputBuilder ??
    ((c: DirectoryConfig, n: number) => ({
      // Generic shape: pass through the canonical search fields. Most
      // actors accept at least one of these key names.
      query: c.query ?? c.category,
      keywords: c.query ?? c.category,
      location: c.geo,
      maxItems: Math.min(n, 200),
    }));
  const itemToLead =
    preset?.itemToLead ??
    ((item, sId, c) => genericItemToLead(item, sId, c));

  const input = inputBuilder(cfg, maxResults);
  log(
    `Apify: running actor ${actorId}${preset ? ` (preset: ${preset.id})` : " (custom)"}`
  );

  let result;
  try {
    result = await runActorAndGetItems(actorId, input, {
      signal,
      itemLimit: Math.max(maxResults, 50),
      onProgress: (run) => log(`Apify: run ${run.id} ${run.status}`),
    });
  } catch (err) {
    log(`Apify run failed: ${String(err)}`);
    return { count: 0, costUsd: 0 };
  }

  const items = result.items;
  const costUsd = result.run.usageTotalUsd ?? 0;
  log(`Apify: ${items.length} item(s) from run ${result.run.id}, cost $${costUsd.toFixed(4)}`);

  let inserted = 0;
  for (const item of items.slice(0, maxResults)) {
    if (signal.aborted) break;
    const adapted: ApifyLeadInput | undefined = itemToLead(item, searchId, cfg);
    if (!adapted) continue;
    const { lead, isNew } = insertLead(adapted);
    if (isNew) {
      inserted += 1;
      onInsert(lead);
    }
  }
  log(`Apify: inserted ${inserted} new lead(s)`);
  return { count: inserted, costUsd };
}

// --- Yelp Playwright direct path -----------------------------------------
// Self-hosted scraper: requires playwright installed on the host. Reports
// the install error in the search log and returns 0 when unavailable so
// the runner doesn't crash.
async function runYelpDirect(
  cfg: DirectoryConfig,
  maxResults: number,
  searchId: string,
  signal: AbortSignal,
  log: (line: string) => void,
  onInsert: (lead: DiscoveredLead) => void
): Promise<number> {
  const term = cfg.query ?? cfg.category;
  const geo = cfg.geo;
  if (!term || !geo) {
    log(`Yelp (Playwright): need both a query/category and a geo to search`);
    return 0;
  }

  let businesses;
  try {
    log(`Yelp (Playwright): searching "${term}" near "${geo}"`);
    businesses = await searchYelpDirect({
      category: cfg.category,
      query: cfg.query,
      geo,
      maxResults,
      signal,
    });
  } catch (err) {
    log(`Yelp (Playwright) failed: ${String(err)}`);
    return 0;
  }

  if (businesses.length === 0) {
    log(`Yelp (Playwright): 0 results — try a different category or geo`);
    return 0;
  }
  log(
    `Yelp (Playwright): ${businesses.length} candidate(s) before dedup, taking up to ${maxResults}`
  );

  let inserted = 0;
  for (const b of businesses.slice(0, maxResults)) {
    if (signal.aborted) break;
    const input = yelpDirectToLeadInput(b, searchId, cfg.category, geo);
    const { lead, isNew } = insertLead(input);
    if (isNew) {
      inserted += 1;
      onInsert(lead);
    }
  }
  log(`Yelp (Playwright): inserted ${inserted} new lead(s)`);
  return inserted;
}

// --- BBB Playwright direct path ------------------------------------------
// Same shape as runYelpDirect but pointed at bbb.org. BBB-specific tags
// (accreditation, A-F rating, years in business) are folded into the
// matchReason string by bbbDirectToLeadInput.
async function runBbbDirect(
  cfg: DirectoryConfig,
  maxResults: number,
  searchId: string,
  signal: AbortSignal,
  log: (line: string) => void,
  onInsert: (lead: DiscoveredLead) => void
): Promise<number> {
  const term = cfg.query ?? cfg.category;
  const geo = cfg.geo;
  if (!term || !geo) {
    log(`BBB (Playwright): need both a query/category and a geo to search`);
    return 0;
  }

  let businesses;
  try {
    log(`BBB (Playwright): searching "${term}" near "${geo}"`);
    businesses = await searchBbbDirect({
      category: cfg.category,
      query: cfg.query,
      geo,
      maxResults,
      signal,
    });
  } catch (err) {
    log(`BBB (Playwright) failed: ${String(err)}`);
    return 0;
  }

  if (businesses.length === 0) {
    log(`BBB (Playwright): 0 results — try a different category or geo`);
    return 0;
  }
  log(
    `BBB (Playwright): ${businesses.length} candidate(s) before dedup, taking up to ${maxResults}`
  );

  let inserted = 0;
  for (const b of businesses.slice(0, maxResults)) {
    if (signal.aborted) break;
    const input = bbbDirectToLeadInput(b, searchId, cfg.category, geo);
    const { lead, isNew } = insertLead(input);
    if (isNew) {
      inserted += 1;
      onInsert(lead);
    }
  }
  log(`BBB (Playwright): inserted ${inserted} new lead(s)`);
  return inserted;
}

// --- Bing Local Search direct path ---------------------------------------
// Bing's Local Search caps at 25 results per call with no pagination, so
// dense metros must be tile-fanned. We always tile when the requested
// radius exceeds the per-call tile size to keep coverage uniform.
async function runBingPlacesDirect(
  cfg: DirectoryConfig,
  maxResults: number,
  searchId: string,
  signal: AbortSignal,
  log: (line: string) => void,
  onInsert: (lead: DiscoveredLead) => void
): Promise<number> {
  const category = cfg.category;
  const query = cfg.query ?? cfg.category;

  const { lat, lng, geoLabel } = resolveLatLng(cfg);

  if (lat === undefined || lng === undefined) {
    log(`Bing Local Search: missing geo — supply lat/lng, zip, or a parseable city/zip in geo`);
    return 0;
  }

  const radiusMiles = cfg.radiusMiles ?? 10;
  const tileMiles = suggestedTileMiles("bing_places", "med");
  const tiles = tilesForRadius(lat, lng, radiusMiles, tileMiles, { maxTiles: 25 });
  log(
    `Bing Local Search: ${tiles.length} tile(s) of ~${tileMiles}mi covering ${radiusMiles}mi around ${lat.toFixed(4)},${lng.toFixed(4)}`
  );

  const collected: BingPlace[] = [];
  for (const tile of tiles) {
    if (signal.aborted) break;
    if (collected.length >= maxResults) break;
    try {
      const batch = await searchBingLocal({
        lat: tile.lat,
        lng: tile.lng,
        radiusMiles: tile.radiusMiles,
        category,
        query,
        maxResults: 25,
        signal,
      });
      collected.push(...batch);
    } catch (err) {
      log(`Bing Local Search tile failed: ${String(err)}`);
    }
  }

  const results = dedupeById(collected, (p) => p.bingId);
  if (results.length === 0) {
    log(`Bing Local Search: 0 results — try a different category preset or widen the radius`);
    return 0;
  }
  log(`Bing Local Search: ${results.length} candidate(s) before dedup, taking up to ${maxResults}`);

  let inserted = 0;
  for (const p of results.slice(0, maxResults)) {
    if (signal.aborted) break;
    const input = bingPlaceToLeadInput(p, searchId, category, geoLabel);
    const { lead, isNew } = insertLead(input);
    if (isNew) {
      inserted += 1;
      onInsert(lead);
    }
  }
  log(`Bing Local Search: inserted ${inserted} new lead(s)`);
  return inserted;
}

// --- Webhook delivery ------------------------------------------------------
async function maybeDeliverWebhook(
  webhookUrl: string | undefined,
  searchId: string,
  leads: DiscoveredLead[],
  log: (line: string) => void
): Promise<void> {
  if (!webhookUrl || leads.length === 0) return;
  let ok = 0;
  let fail = 0;
  // Deliveries are independent — fan out concurrently with a small ceiling
  // so a slow webhook doesn't dominate runtime.
  const CONCURRENCY = 5;
  let i = 0;
  const worker = async () => {
    while (i < leads.length) {
      const idx = i++;
      const lead = leads[idx];
      const success = await deliverWebhook(webhookUrl, {
        searchId,
        leadId: lead.id,
        companyName: lead.companyName,
        websiteUrl: lead.websiteUrl,
        linkedinUrl: lead.linkedinUrl,
        phone: lead.phone,
        streetAddress: lead.streetAddress,
        city: lead.city,
        region: lead.region,
        postalCode: lead.postalCode,
        countryCode: lead.countryCode,
        lat: lead.lat,
        lng: lead.lng,
        location: lead.location,
        industry: lead.industry,
        description: lead.description,
        matchReason: lead.matchReason,
        sourceUrl: lead.sourceUrl,
        placeId: lead.placeId,
        hours: lead.hours,
        naicsCode: lead.naicsCode,
        licenseNumber: lead.licenseNumber,
        score: lead.score,
        firstSeenAt: lead.firstSeenAt ?? lead.createdAt,
      });
      if (success) ok += 1;
      else fail += 1;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, leads.length) }, worker)
  );
  log(`Webhook: ${ok} delivered, ${fail} failed`);
}

async function deliverWebhook(
  url: string,
  payload: Record<string, unknown>
): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// --- Firecrawl pre-fetch ---------------------------------------------------
// Before the agent runs, we use Firecrawl (when configured) to pull clean
// markdown from the most useful starting URL for the search. The agent then
// works from that content instead of trying to WebFetch a JS-heavy page and
// getting blocked. For directory roots we also call /v1/map to enumerate
// profile URLs under the root (chamber of commerce member lists, association
// directories, etc.), giving the agent a concrete URL pool to work from.
// Returns `{ content, credits, costUsd }` so the caller can roll Firecrawl
// spend into the search's total cost.

const MAX_PREFETCH_CHARS = 35_000;
const MAX_MAP_URLS_IN_PROMPT = 100;

type PrefetchResult = {
  content: string | undefined;
  credits: number;
  costUsd: number;
};

type DiscoverySearchInit = ReturnType<typeof getSearch>;

function emptyPrefetch(): PrefetchResult {
  return { content: undefined, credits: 0, costUsd: 0 };
}

async function firecrawlPreFetch(
  search: NonNullable<DiscoverySearchInit>,
  signal: AbortSignal,
  log: (line: string) => void
): Promise<PrefetchResult> {
  if (!firecrawl.isConfigured()) return emptyPrefetch();

  try {
    if (search.mode === "icp") {
      log(`Firecrawl: searching for ICP candidates`);
      const { results, cost } = await firecrawl.search(search.queryText, {
        limit: 8,
        scrapeMarkdown: true,
        signal,
      });
      if (results.length === 0) {
        log(`Firecrawl: search returned no results — agent will fall back to WebSearch`);
        return { content: undefined, credits: cost.credits, costUsd: cost.costUsd };
      }
      log(`Firecrawl: pulled ${results.length} search result(s) with markdown`);
      return {
        content: firecrawl.formatSearchResultsForPrompt(results, 3000).slice(0, MAX_PREFETCH_CHARS),
        credits: cost.credits,
        costUsd: cost.costUsd,
      };
    }

    if (search.mode === "directory" && search.directoryConfig) {
      return await prefetchForDirectory(search.directoryConfig, signal, log);
    }

    if (
      search.mode === "signal_funding" ||
      search.mode === "signal_hiring" ||
      search.mode === "signal_news" ||
      search.mode === "signal_reviews" ||
      search.mode === "signal_new_business" ||
      search.mode === "signal_license"
    ) {
      // Signal runs get a Firecrawl search seeded from the rendered queryText
      // — the runner already encodes filters + timeframe in that text.
      log(`Firecrawl: searching for signal candidates`);
      const { results, cost } = await firecrawl.search(search.queryText, {
        limit: 6,
        scrapeMarkdown: true,
        tbs: "qdr:m",
        signal,
      });
      if (results.length === 0) {
        return { content: undefined, credits: cost.credits, costUsd: cost.costUsd };
      }
      log(`Firecrawl: pulled ${results.length} signal result(s)`);
      return {
        content: firecrawl.formatSearchResultsForPrompt(results, 2500).slice(0, MAX_PREFETCH_CHARS),
        credits: cost.credits,
        costUsd: cost.costUsd,
      };
    }
  } catch (err) {
    log(`Firecrawl pre-fetch failed: ${String(err)} — agent will fall back to WebFetch`);
    return emptyPrefetch();
  }

  return emptyPrefetch();
}

async function prefetchForDirectory(
  cfg: DirectoryConfig,
  signal: AbortSignal,
  log: (line: string) => void
): Promise<PrefetchResult> {
  const { source } = cfg;
  let credits = 0;
  let costUsd = 0;
  const sections: string[] = [];

  // For sources with a predictable public search URL, scrape it directly via
  // the cached fallback chain. Cache hits cost nothing; misses fall through
  // to Firecrawl, then Wayback, then Google cache.
  const directUrl = buildDirectoryUrl(source, cfg);
  if (directUrl) {
    log(`Firecrawl: scraping ${directUrl}`);
    const fallback = await firecrawl.scrapeWithFallback(directUrl, {
      formats: ["markdown", "links"],
      onlyMainContent: true,
      signal,
    });
    credits += fallback.cost.credits;
    costUsd += fallback.cost.costUsd;
    if (fallback.fromCache) {
      log(`Scrape cache HIT for ${directUrl} (source=${fallback.source})`);
    }
    if (fallback.result?.markdown) {
      const truncated = firecrawl.truncateMarkdown(fallback.result.markdown, MAX_PREFETCH_CHARS);
      log(
        `Firecrawl: ${fallback.fromCache ? "loaded cached" : "scraped"} ${fallback.result.markdown.length} chars from ${directUrl} (via ${fallback.source})`
      );
      sections.push(`### Source: ${directUrl}\n\n${truncated}`);
    } else {
      log(`Firecrawl: every fallback tier returned no usable markdown for ${directUrl}`);
    }

    // For directory-style roots, follow up with /v1/map to enumerate profile
    // URLs under the root. The agent uses this list to walk member pages /
    // business listings deterministically instead of hunting for them.
    if (shouldMapDirectory(source, directUrl)) {
      log(`Firecrawl: mapping URLs under ${directUrl}`);
      const { result: mapped, cost: mapCost } = await firecrawl.map(directUrl, {
        search: cfg.query || cfg.category,
        limit: MAX_MAP_URLS_IN_PROMPT,
        signal,
      });
      credits += mapCost.credits;
      costUsd += mapCost.costUsd;
      if (mapped?.links?.length) {
        const trimmed = mapped.links.slice(0, MAX_MAP_URLS_IN_PROMPT);
        log(`Firecrawl: /map enumerated ${mapped.links.length} URL(s), keeping ${trimmed.length}`);
        sections.push(formatMappedUrls(directUrl, trimmed));
      } else {
        log(`Firecrawl: /map returned no URLs for ${directUrl}`);
      }
    }
  }

  // For firecrawl_search and tech_stack, use /search to gather listicles and
  // vendor pages the agent would otherwise hunt for.
  if (source === "firecrawl_search" || source === "tech_stack") {
    const query = buildSearchQuery(cfg);
    if (query) {
      log(`Firecrawl: searching "${query}"`);
      const { results, cost } = await firecrawl.search(query, {
        limit: 10,
        scrapeMarkdown: true,
        signal,
      });
      credits += cost.credits;
      costUsd += cost.costUsd;
      if (results.length === 0) {
        log(`Firecrawl: search returned no results`);
      } else {
        log(`Firecrawl: pulled ${results.length} result(s)`);
        sections.push(firecrawl.formatSearchResultsForPrompt(results, 2500));
      }
    }
  }

  // For state-scoped directories, sketch in the per-state context the agent
  // needs (search URL, board name, license types, notes) so it doesn't have
  // to rediscover them each run.
  if (source === "state_license_board" || source === "state_sos") {
    const state = cfg.state;
    if (state) {
      const reg = getStateRegistry(state);
      if (reg) {
        const e = source === "state_license_board" ? reg.licenseBoard : reg.sos;
        const block = [
          `### State registry context: ${reg.stateName}`,
          source === "state_license_board"
            ? `Board: ${reg.licenseBoard.boardName}\nLicense types covered: ${reg.licenseBoard.licenseTypes.join(", ")}`
            : "",
          `Search URL: ${(e as { searchUrl: string }).searchUrl}`,
          (e as { needsCaptcha?: boolean }).needsCaptcha
            ? "Note: this source has CAPTCHA / bot protection — fall back to a Google site:<host> query if direct fetch fails."
            : "",
          `Notes: ${(e as { notes: string }).notes}`,
        ]
          .filter(Boolean)
          .join("\n");
        sections.push(block);
      }
    }
  }

  // For custom directories the user may pass only a root URL (no category).
  // When the root URL is present but we couldn't scrape anything above (e.g.
  // the root itself is a thin landing page), still enumerate member URLs via
  // /map so the agent has something to iterate over.
  if (source === "custom" && cfg.url && sections.length === 0) {
    log(`Firecrawl: mapping URLs under ${cfg.url}`);
    const { result: mapped, cost: mapCost } = await firecrawl.map(cfg.url, {
      search: cfg.query,
      limit: MAX_MAP_URLS_IN_PROMPT,
      signal,
    });
    credits += mapCost.credits;
    costUsd += mapCost.costUsd;
    if (mapped?.links?.length) {
      const trimmed = mapped.links.slice(0, MAX_MAP_URLS_IN_PROMPT);
      log(`Firecrawl: /map enumerated ${mapped.links.length} URL(s), keeping ${trimmed.length}`);
      sections.push(formatMappedUrls(cfg.url, trimmed));
    }
  }

  // Geo expansion: if the user provided lat/lng + radius, expand to a list
  // of bundled US zips and inject them into the prompt context. The agent
  // can use this list to issue per-zip searches inside a single turn — much
  // higher coverage than a single city query.
  if (cfg.lat !== undefined && cfg.lng !== undefined && cfg.radiusMiles) {
    const zips = expandZipsForRadius(cfg.lat, cfg.lng, cfg.radiusMiles, { limit: 25 });
    if (zips.length > 0) {
      const lines = zips
        .map((z) => `- ${z.zip} (${z.city}, ${z.state}) — ${z.distanceMiles.toFixed(1)} mi`)
        .join("\n");
      sections.push(
        `### Geo expansion: ${zips.length} zip(s) within ${cfg.radiusMiles} mi of ${cfg.lat.toFixed(4)},${cfg.lng.toFixed(4)}\n\n${lines}\n\nUse these zips to expand your search beyond the centre city.`
      );
      log(`Geo: expanded radius ${cfg.radiusMiles} mi → ${zips.length} bundled zip(s)`);
    }
  }

  if (sections.length === 0) {
    return { content: undefined, credits, costUsd };
  }
  return {
    content: sections.join("\n\n---\n\n").slice(0, MAX_PREFETCH_CHARS),
    credits,
    costUsd,
  };
}

// Directory sources whose root URLs are typically real directories of profile
// pages (chambers, association member lists, YC batches, PH topic pages, etc.)
// — cheap to enumerate with /v1/map. We skip /map for search result URLs
// (google_maps) and sources that require an authenticated session.
function shouldMapDirectory(source: DirectorySource, url: string): boolean {
  if (source === "google_maps") return false;
  if (source === "facebook_pages") return false;
  if (source === "firecrawl_search" || source === "tech_stack") return false;
  if (source === "google_lsa") return false;
  if (source === "nextdoor") return false;
  if (source === "state_license_board" || source === "state_sos") return false;
  if (source === "delivery_marketplace") return false;
  try {
    const u = new URL(url);
    // yelp/bbb/angi search result pages are paginated — /map would enumerate
    // the whole domain, not the search slice. Let the scrape carry those.
    if (u.pathname.includes("/search")) return false;
  } catch {
    return false;
  }
  return true;
}

function formatMappedUrls(root: string, urls: string[]): string {
  return (
    `### Profile URLs enumerated under ${root} (via /v1/map)\n\n` +
    `The following ${urls.length} URL(s) were discovered under the directory root. ` +
    `Treat them as candidate profile pages and WebFetch the most relevant ones to extract companies.\n\n` +
    urls.map((u) => `- ${u}`).join("\n")
  );
}

function buildDirectoryUrl(
  source: DirectorySource,
  cfg: DirectoryConfig
): string | undefined {
  const q = (s: string) => encodeURIComponent(s);
  switch (source) {
    case "custom":
      return cfg.url;
    case "yelp":
      if (!cfg.category && !cfg.query) return undefined;
      return `https://www.yelp.com/search?find_desc=${q(cfg.category ?? cfg.query ?? "")}${cfg.geo ? `&find_loc=${q(cfg.geo)}` : ""}`;
    case "bbb":
      if (!cfg.category && !cfg.query) return undefined;
      return `https://www.bbb.org/search?find_country=USA&find_text=${q(cfg.category ?? cfg.query ?? "")}${cfg.geo ? `&find_loc=${q(cfg.geo)}` : ""}`;
    case "angi":
      if (!cfg.category && !cfg.query) return undefined;
      return `https://www.angi.com/companylist.htm?searchtext=${q(cfg.category ?? cfg.query ?? "")}${cfg.geo ? `&geolocation=${q(cfg.geo)}` : ""}`;
    case "google_maps":
      if (!cfg.category && !cfg.query) return undefined;
      return `https://www.google.com/maps/search/${q(`${cfg.category ?? cfg.query} in ${cfg.geo ?? ""}`)}`;
    case "yc":
      return `https://www.ycombinator.com/companies${cfg.batch ? `?batch=${q(cfg.batch)}` : ""}`;
    case "producthunt":
      return cfg.category
        ? `https://www.producthunt.com/topics/${q(cfg.category)}`
        : "https://www.producthunt.com";
    case "github":
      return cfg.category
        ? `https://github.com/topics/${q(cfg.category)}`
        : undefined;
    case "yellowpages":
      if (!cfg.category && !cfg.query) return undefined;
      return `https://www.yellowpages.com/search?search_terms=${q(cfg.category ?? cfg.query ?? "")}${cfg.geo ? `&geo_location_terms=${q(cfg.geo)}` : ""}`;
    case "manta":
      if (!cfg.category && !cfg.query) return undefined;
      return `https://www.manta.com/search?search=${q(cfg.category ?? cfg.query ?? "")}${cfg.geo ? `&search_location=${q(cfg.geo)}` : ""}`;
    case "houzz":
      if (!cfg.category && !cfg.query) return undefined;
      return `https://www.houzz.com/professionals/${q((cfg.category ?? cfg.query ?? "").toLowerCase().replace(/\s+/g, "-"))}/${q(cfg.geo ?? "")}`;
    case "opentable":
      return `https://www.opentable.com/s?term=${q(cfg.geo ?? "")}${cfg.category ? `&cuisineIds=${q(cfg.category)}` : ""}`;
    case "tripadvisor":
      return `https://www.tripadvisor.com/Search?q=${q(`${cfg.category ?? cfg.query ?? ""} ${cfg.geo ?? ""}`.trim())}`;
    case "google_lsa":
      if (!cfg.category && !cfg.query) return undefined;
      return `https://www.google.com/localservices/prolist?q=${q(`${cfg.category ?? cfg.query} ${cfg.geo ?? ""}`.trim())}`;
    // Sources without a stable single URL — handled by the agent using the
    // prompt-level guidance (state registries, marketplaces, Nextdoor, etc.)
    case "facebook_pages":
    case "tech_stack":
    case "firecrawl_search":
    case "osm_overpass":
    case "nextdoor":
    case "delivery_marketplace":
    case "state_license_board":
    case "state_sos":
      return undefined;
  }
}

function buildSearchQuery(cfg: DirectoryConfig): string | undefined {
  if (cfg.source === "firecrawl_search") {
    return cfg.query ?? cfg.category;
  }
  if (cfg.source === "tech_stack") {
    const tech = cfg.techStack ?? cfg.query;
    if (!tech) return undefined;
    const geo = cfg.geo ? ` ${cfg.geo}` : "";
    return `"${tech}" customers OR "case study"${geo}`;
  }
  return undefined;
}

export function startSearch(params: {
  workspaceId: string;
  mode: DiscoveryMode;
  name: string;
  queryText: string;
  seedCompanies?: string[];
  directoryConfig?: DirectoryConfig;
  maxResults: number;
  webhookUrl?: string;
}): StartSearchResult {
  const usage = getCurrentUsage();
  const caps = capStatus(usage);
  if (caps.exceeded) {
    return {
      status: "cap_exceeded",
      reason: `Monthly cap reached ($${usage.costUsd.toFixed(2)}/$${caps.costCap} spend). Discovery also burns budget via web search — bump MONITOR_MONTHLY_COST_CAP to continue.`,
    };
  }

  const search = createSearch({
    workspaceId: params.workspaceId,
    mode: params.mode,
    name: params.name,
    queryText: params.queryText,
    seedCompanies: params.seedCompanies,
    directoryConfig: params.directoryConfig,
    maxResults: params.maxResults,
    webhookUrl: params.webhookUrl,
  });

  void executeSearch(search.id).catch((err) => {
    updateSearch(search.id, {
      status: "failed",
      error: String(err),
      completedAt: Date.now(),
    });
  });

  return { status: "started", searchId: search.id };
}

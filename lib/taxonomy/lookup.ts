// Vertical taxonomy lookups.
//
// Free-text in / structured codes out. Three lookup paths:
//   - getVertical(slug)            — exact slug match (the canonical key
//     used by every directory connector's preset map)
//   - findVerticalByQuery(text)    — fuzzy resolve of free-text the
//     user typed in the discover form ("plumbing services" → plumber)
//   - suggestVerticals(prefix)     — prefix match for typeahead UI
//
// The fuzzy resolver runs three passes in order — exact slug, exact
// alias, then substring on alias. Earlier passes win, so the most
// specific match wins. Returns undefined when nothing scores.

import { VERTICALS, type Vertical } from "./verticals";

const SLUG_INDEX = new Map<string, Vertical>(
  VERTICALS.map((v) => [v.slug.toLowerCase(), v])
);

const ALIAS_INDEX = new Map<string, Vertical>();
for (const v of VERTICALS) {
  ALIAS_INDEX.set(v.slug.toLowerCase(), v);
  ALIAS_INDEX.set(v.label.toLowerCase(), v);
  for (const alias of v.aliases) ALIAS_INDEX.set(alias.toLowerCase(), v);
}

export function getVertical(slug: string): Vertical | undefined {
  if (!slug) return undefined;
  return SLUG_INDEX.get(slug.trim().toLowerCase());
}

export function findVerticalByQuery(text: string): Vertical | undefined {
  if (!text) return undefined;
  const q = text.trim().toLowerCase();
  if (!q) return undefined;

  // Exact alias / label / slug.
  const exact = ALIAS_INDEX.get(q);
  if (exact) return exact;

  // Substring on aliases. Score by alias length so the most specific
  // alias wins ("hvac contractor" beats "hvac" when both substring-match
  // a longer query).
  let best: Vertical | undefined;
  let bestScore = 0;
  for (const v of VERTICALS) {
    for (const alias of [v.label, v.slug, ...v.aliases]) {
      const a = alias.toLowerCase();
      if (q.includes(a) && a.length > bestScore) {
        best = v;
        bestScore = a.length;
      } else if (a.includes(q) && q.length > 2 && q.length > bestScore) {
        // Reverse direction: query is a substring of an alias. Only
        // accept when the query is at least 3 chars to avoid noise.
        best = v;
        bestScore = q.length;
      }
    }
  }
  return best;
}

export function suggestVerticals(prefix: string, limit = 10): Vertical[] {
  const p = prefix.trim().toLowerCase();
  if (!p) return [];
  const out: Vertical[] = [];
  const seen = new Set<string>();
  for (const v of VERTICALS) {
    if (out.length >= limit) break;
    if (seen.has(v.slug)) continue;
    if (
      v.slug.startsWith(p) ||
      v.label.toLowerCase().startsWith(p) ||
      v.aliases.some((a) => a.toLowerCase().startsWith(p))
    ) {
      out.push(v);
      seen.add(v.slug);
    }
  }
  return out;
}

/**
 * Convenience: primary NAICS code for a vertical (string form, may be
 * 4-6 digits). Returns undefined when the vertical is unknown or has
 * no NAICS mapping.
 */
export function getNaicsCode(slugOrText: string): string | undefined {
  const v = getVertical(slugOrText) ?? findVerticalByQuery(slugOrText);
  return v?.naics[0];
}

/** All NAICS codes (primary first) for a vertical. */
export function getNaicsCodes(slugOrText: string): string[] {
  const v = getVertical(slugOrText) ?? findVerticalByQuery(slugOrText);
  return v?.naics ?? [];
}

/** Primary SIC code for a vertical. */
export function getSicCode(slugOrText: string): string | undefined {
  const v = getVertical(slugOrText) ?? findVerticalByQuery(slugOrText);
  return v?.sic[0];
}

export function listVerticals(): readonly Vertical[] {
  return VERTICALS;
}

export function listVerticalsByParent(parent: string): Vertical[] {
  return VERTICALS.filter((v) => v.parent === parent);
}

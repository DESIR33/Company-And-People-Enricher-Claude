// Pull the first complete JSON object out of a string, ignoring braces that
// appear inside string literals. Used as a fallback when the agent's response
// contains prose around the JSON. A naive `/\{[\s\S]*\}/` greedy regex grabs
// from the first `{` to the LAST `}`, which fails when there's any other `{`
// or `}` in the surrounding prose. This walks the string instead, tracking
// brace depth and string-literal state so the returned slice is always the
// first balanced object.
export function extractFirstJsonObject(s: string): string | undefined {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      if (depth === 0) continue;
      depth--;
      if (depth === 0 && start !== -1) {
        return s.slice(start, i + 1);
      }
    }
  }
  return undefined;
}

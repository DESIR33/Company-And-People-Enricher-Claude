import { query, SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "@anthropic-ai/claude-agent-sdk";
import { resolveClaudeCodeExecutable } from "./claude-runtime";
import type { MonitorConfig, MonitorMode } from "./monitor-store";

export type DiscoveredEngager = {
  linkedinUrl: string;
  name?: string;
  engagementType?: "like" | "comment" | "reaction";
  engagementText?: string;
  postUrl?: string;
};

export type DiscoveryResult = {
  engagers: DiscoveredEngager[];
  costUsd: number;
  log: string[];
  note?: string;
};

type DiscoveryParams = {
  mode: MonitorMode;
  config: MonitorConfig;
  signal?: AbortSignal;
  model?: string;
  onLog?: (line: string) => void;
};

const MAX_DISCOVERY_TURNS = 20;

// LinkedIn aggressively blocks logged-out agent fetches, so discovery from
// a pure agent workflow is best-effort. The prompts are shaped so the model
// honestly reports "no public data" instead of hallucinating a profile list.
function buildPrompts(params: DiscoveryParams): { system: string; user: string } {
  const common = `You are a LinkedIn engagement discovery agent. Your job is to find LinkedIn users who publicly engaged (liked / commented / reacted) with specific posts.

IMPORTANT — HONESTY RULES:
1. LinkedIn blocks most unauthenticated page loads. If WebFetch to linkedin.com returns a login wall, a 403, or empty content, SAY SO and return an empty list for that post. DO NOT invent names.
2. Only include a person if you can point to a specific, verifiable source — a public cache, a news article, a Twitter/X post, a blog post republishing the LinkedIn thread, or a Google search result that shows the engagement.
3. Every engager MUST have a real LinkedIn profile URL of the form https://www.linkedin.com/in/<slug>. If you do not have a concrete slug, skip the person.
4. Never fabricate the post URL. If you cannot find the exact post, report that the post was inaccessible.

RESEARCH TOOLS AVAILABLE:
- WebSearch — use Google-style queries to surface public mentions of the post's engagers.
- WebFetch — load a URL. Try LinkedIn first, fall back to cache/archives if blocked.

OUTPUT FORMAT:
Return ONLY a single JSON object, no prose, no code fences:
{
  "note": "one-sentence summary of what you were able to find (or why not)",
  "engagers": [
    {
      "linkedinUrl": "https://www.linkedin.com/in/<slug>",
      "name": "First Last",
      "engagementType": "like" | "comment" | "reaction",
      "engagementText": "comment text if a comment, else empty string",
      "postUrl": "the specific post URL this engagement was on"
    }
  ]
}
If you find nothing, return {"note":"...","engagers":[]}. DO NOT include markdown.`;

  if (params.mode === "post" || params.mode === "instant") {
    const urls = params.config.postUrls ?? [];
    const list = urls.map((u, i) => `${i + 1}. ${u}`).join("\n");
    return {
      system: common,
      user: `Find public engagers on the following LinkedIn post URL(s):

${list}

For EACH post:
- Try WebFetch on the URL. If blocked, search Google for: site:linkedin.com/posts "<keywords from the URL slug>"
- Look for aggregator sites, cached versions, or people referencing the post publicly.
- Collect every distinct LinkedIn profile that can be verified as an engager.

Target: up to 50 engagers across all posts.`,
    };
  }

  if (params.mode === "profile") {
    const profile = params.config.profileUrl ?? "";
    return {
      system: common,
      user: `Monitor the LinkedIn profile: ${profile}

Find their most recent public post (within the last 14 days), then find people who engaged with it.

Workflow:
1. WebSearch: '"${profile}" recent post' or 'site:linkedin.com/posts <username from URL>'
2. WebFetch the posts page if available; otherwise use whatever public cache surfaces.
3. For each recent post you can identify, collect engagers.

Target: up to 50 engagers across recent posts. If the profile has no public recent posts, return {"note": "...", "engagers": []}.`,
    };
  }

  // keyword mode
  const keywords = params.config.keywords ?? [];
  return {
    system: common,
    user: `Find LinkedIn posts about the following topic(s) and collect people who engaged with them:

Keywords: ${keywords.join(", ")}

Workflow:
1. WebSearch: site:linkedin.com/posts <keyword> — for each keyword, look at the top 5 results.
2. WebFetch each surfaced post to confirm relevance. Skip posts older than 30 days.
3. For each relevant post, collect its engagers using the same honesty rules above.

Target: up to 50 engagers total across matching posts.`,
  };
}

type DiscoveryJSON = {
  note?: string;
  engagers?: Array<{
    linkedinUrl?: string;
    name?: string;
    engagementType?: string;
    engagementText?: string;
    postUrl?: string;
  }>;
};

function parseDiscovery(raw: string): DiscoveryJSON {
  const cleaned = raw
    .replace(/^```json\s*/im, "")
    .replace(/^```\s*/im, "")
    .replace(/```\s*$/m, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { engagers: [] };
    try {
      return JSON.parse(match[0]);
    } catch {
      return { engagers: [] };
    }
  }
}

const LINKEDIN_PROFILE_RE = /^https?:\/\/(www\.)?linkedin\.com\/in\/[^/?#\s]+\/?/i;

function normaliseEngager(e: {
  linkedinUrl?: string;
  name?: string;
  engagementType?: string;
  engagementText?: string;
  postUrl?: string;
}): DiscoveredEngager | undefined {
  const url = (e.linkedinUrl ?? "").trim();
  if (!LINKEDIN_PROFILE_RE.test(url)) return undefined;
  const normalisedUrl = url.replace(/\/$/, "").replace(/^http:\/\//i, "https://");
  const type = e.engagementType?.toLowerCase();
  const engagementType =
    type === "like" || type === "comment" || type === "reaction" ? type : undefined;
  return {
    linkedinUrl: normalisedUrl,
    name: e.name?.trim() || undefined,
    engagementType,
    engagementText: e.engagementText?.trim() || undefined,
    postUrl: e.postUrl?.trim() || undefined,
  };
}

export async function discoverEngagers(
  params: DiscoveryParams
): Promise<DiscoveryResult> {
  const { system, user } = buildPrompts(params);
  const log: string[] = [];
  const push = (line: string): void => {
    log.push(`[${new Date().toISOString()}] ${line}`);
    params.onLog?.(line);
  };

  push(`Discovery started — mode=${params.mode}`);

  let raw = "";
  let costUsd = 0;

  try {
    for await (const message of query({
      prompt: user,
      options: {
        model: params.model ?? "claude-haiku-4-5-20251001",
        systemPrompt: [system, SYSTEM_PROMPT_DYNAMIC_BOUNDARY],
        allowedTools: ["WebSearch", "WebFetch"],
        maxTurns: MAX_DISCOVERY_TURNS,
        permissionMode: "acceptEdits",
        pathToClaudeCodeExecutable: resolveClaudeCodeExecutable(),
        abortController: (() => {
          const ctrl = new AbortController();
          if (params.signal) {
            if (params.signal.aborted) ctrl.abort();
            else params.signal.addEventListener("abort", () => ctrl.abort(), { once: true });
          }
          return ctrl;
        })(),
      },
    })) {
      if (
        typeof message === "object" &&
        message !== null &&
        (message as { type?: string }).type === "result"
      ) {
        const msg = message as {
          subtype?: string;
          result?: unknown;
          total_cost_usd?: number;
        };
        costUsd += msg.total_cost_usd ?? 0;
        if (msg.subtype === "success") raw = String(msg.result ?? "");
      }
    }
  } catch (err) {
    push(`Discovery aborted: ${String(err)}`);
    return { engagers: [], costUsd, log, note: "Discovery aborted" };
  }

  if (!raw) {
    push("Agent returned no result");
    return { engagers: [], costUsd, log, note: "No discovery output" };
  }

  const parsed = parseDiscovery(raw);
  const seen = new Set<string>();
  const engagers: DiscoveredEngager[] = [];
  for (const e of parsed.engagers ?? []) {
    const n = normaliseEngager(e);
    if (!n) continue;
    if (seen.has(n.linkedinUrl)) continue;
    seen.add(n.linkedinUrl);
    engagers.push(n);
  }

  push(`Discovery complete — ${engagers.length} engager(s) from agent`);
  if (parsed.note) push(`Agent note: ${parsed.note}`);

  return { engagers, costUsd, log, note: parsed.note };
}

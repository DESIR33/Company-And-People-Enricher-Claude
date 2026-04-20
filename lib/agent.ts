import { query } from "@anthropic-ai/claude-agent-sdk";
import { COMPANY_FIELDS, PEOPLE_FIELDS, type FieldDefinition } from "./enrichment-fields";

type AgentEnrichParams = {
  type: "company" | "people";
  identifier: string;
  requestedFields: string[];
};

function buildPrompt(params: AgentEnrichParams): string {
  const allFields = params.type === "company" ? COMPANY_FIELDS : PEOPLE_FIELDS;
  const fields = allFields.filter(
    (f) => params.requestedFields.includes(f.key) && !f.requiresProspeo
  );

  const fieldLines = fields.map((f: FieldDefinition) => `- ${f.key}: ${f.description}`).join("\n");
  const fieldKeys = fields.map((f: FieldDefinition) => `"${f.key}": ""`).join(",\n  ");

  if (params.type === "company") {
    return `You are a company research specialist. Find specific information about a company.

COMPANY IDENTIFIER: ${params.identifier}
(This is the company's website URL or LinkedIn URL)

FIELDS TO FIND:
${fieldLines}

INSTRUCTIONS:
1. Use WebSearch to find the company's website and LinkedIn page
2. Use WebFetch to load the company LinkedIn page and website to extract accurate data
3. For funding and revenue, search "[company name] funding revenue crunchbase"
4. For technologies, search "[company name] tech stack" or fetch their jobs page

OUTPUT FORMAT:
Respond with ONLY a valid JSON object. No markdown, no prose, no code fences.
Use empty string "" for any field you cannot find.

{
  ${fieldKeys}
}`;
  }

  return `You are a professional researcher specializing in business professionals.

PERSON IDENTIFIER: ${params.identifier}
(This is the person's LinkedIn profile URL)

FIELDS TO FIND:
${fieldLines}

INSTRUCTIONS:
1. Use WebFetch to load the LinkedIn profile URL directly
2. Extract job title, company, location, seniority, and headline from the page
3. For seniority level, infer from title: Junior/Mid/Senior/Lead/Manager/Director/VP/C-Suite
4. If the LinkedIn page is blocked, use WebSearch for the person's name + "linkedin"
5. Do NOT attempt to find email — that is handled separately

OUTPUT FORMAT:
Respond with ONLY a valid JSON object. No markdown, no prose, no code fences.
Use empty string "" for any field you cannot find.

{
  ${fieldKeys}
}`;
}

function parseAgentOutput(
  raw: string,
  requestedFields: string[]
): Record<string, string> {
  const emptyResult = Object.fromEntries(requestedFields.map((f) => [f, ""]));

  const cleaned = raw
    .replace(/^```json\s*/im, "")
    .replace(/^```\s*/im, "")
    .replace(/```\s*$/m, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return normalizeFields(parsed, requestedFields);
    }
  } catch {
    // fallthrough
  }

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed === "object" && parsed !== null) {
        return normalizeFields(parsed, requestedFields);
      }
    } catch {
      // fallthrough
    }
  }

  return emptyResult;
}

function normalizeFields(
  parsed: Record<string, unknown>,
  requestedFields: string[]
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of requestedFields) {
    const val = parsed[key];
    if (val === null || val === undefined) {
      result[key] = "";
    } else {
      let str = String(val);
      if (key === "description" && str.length > 500) {
        str = str.slice(0, 497) + "...";
      }
      result[key] = str;
    }
  }
  return result;
}

export async function enrichWithAgent(
  params: AgentEnrichParams
): Promise<{ fields: Record<string, string> }> {
  const nonProspeoFields = params.requestedFields.filter((f) => {
    const allFields = params.type === "company" ? COMPANY_FIELDS : PEOPLE_FIELDS;
    const def = allFields.find((d) => d.key === f);
    return def && !def.requiresProspeo;
  });

  if (nonProspeoFields.length === 0) {
    return { fields: {} };
  }

  let rawResult = "";

  try {
    for await (const message of query({
      prompt: buildPrompt({ ...params, requestedFields: nonProspeoFields }),
      options: {
        allowedTools: ["WebSearch", "WebFetch"],
        maxTurns: 10,
        permissionMode: "acceptEdits",
      },
    })) {
      if (
        typeof message === "object" &&
        message !== null &&
        "result" in message
      ) {
        rawResult = String((message as { result: unknown }).result);
      }
    }
  } catch (err) {
    console.error("Agent error:", err);
    return { fields: Object.fromEntries(nonProspeoFields.map((f) => [f, ""])) };
  }

  const fields = parseAgentOutput(rawResult, nonProspeoFields);
  return { fields };
}

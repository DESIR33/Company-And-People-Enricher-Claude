import { getDb } from "./db";

export type BusinessProfile = {
  workspaceId: string;
  businessName: string;
  offerings: string[];
  serviceGeographies: string[];
  targetIndustries: string[];
  personaTitles: string[];
  companySizeMin?: number;
  companySizeMax?: number;
  dealSizeMin?: number;
  dealSizeMax?: number;
  excludedSegments: string[];
  messagingTone?: string;
  complianceBoundaries: Record<string, unknown> | unknown[];
  createdAt: number;
  updatedAt: number;
};

export type BusinessProfileUpdate = {
  businessName?: string;
  offerings?: string[];
  serviceGeographies?: string[];
  targetIndustries?: string[];
  personaTitles?: string[];
  companySizeMin?: number | null;
  companySizeMax?: number | null;
  dealSizeMin?: number | null;
  dealSizeMax?: number | null;
  excludedSegments?: string[];
  messagingTone?: string | null;
  complianceBoundaries?: Record<string, unknown> | unknown[];
};

type BusinessProfileRow = {
  workspace_id: string;
  business_name: string;
  offerings: string;
  service_geographies: string;
  target_industries: string;
  persona_titles: string;
  company_size_min: number | null;
  company_size_max: number | null;
  deal_size_min: number | null;
  deal_size_max: number | null;
  excluded_segments: string;
  messaging_tone: string | null;
  compliance_boundaries: string;
  created_at: number;
  updated_at: number;
};

function parseStringArray(value: string): string[] {
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === "string");
}

function profileFromRow(row: BusinessProfileRow): BusinessProfile {
  const parsedCompliance = JSON.parse(row.compliance_boundaries);
  return {
    workspaceId: row.workspace_id,
    businessName: row.business_name,
    offerings: parseStringArray(row.offerings),
    serviceGeographies: parseStringArray(row.service_geographies),
    targetIndustries: parseStringArray(row.target_industries),
    personaTitles: parseStringArray(row.persona_titles),
    companySizeMin: row.company_size_min ?? undefined,
    companySizeMax: row.company_size_max ?? undefined,
    dealSizeMin: row.deal_size_min ?? undefined,
    dealSizeMax: row.deal_size_max ?? undefined,
    excludedSegments: parseStringArray(row.excluded_segments),
    messagingTone: row.messaging_tone ?? undefined,
    complianceBoundaries:
      parsedCompliance && typeof parsedCompliance === "object" ? parsedCompliance : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getDefaultBusinessProfileInput(): Omit<BusinessProfile, "createdAt" | "updatedAt"> {
  return {
    workspaceId: "",
    businessName: "",
    offerings: [],
    serviceGeographies: [],
    targetIndustries: [],
    personaTitles: [],
    companySizeMin: undefined,
    companySizeMax: undefined,
    dealSizeMin: undefined,
    dealSizeMax: undefined,
    excludedSegments: [],
    messagingTone: undefined,
    complianceBoundaries: {},
  };
}

function ensureProfileRow(workspaceId: string): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO workspace_business_profiles (
      workspace_id, business_name, offerings, service_geographies, target_industries,
      persona_titles, company_size_min, company_size_max, deal_size_min, deal_size_max,
      excluded_segments, messaging_tone, compliance_boundaries, created_at, updated_at
    ) VALUES (?, '', '[]', '[]', '[]', '[]', NULL, NULL, NULL, NULL, '[]', NULL, '{}', ?, ?)
    ON CONFLICT(workspace_id) DO NOTHING`
  ).run(workspaceId, now, now);
}

export function getBusinessProfile(workspaceId: string): BusinessProfile | undefined {
  const db = getDb();
  ensureProfileRow(workspaceId);
  const row = db
    .prepare(`SELECT * FROM workspace_business_profiles WHERE workspace_id = ?`)
    .get(workspaceId) as BusinessProfileRow | undefined;
  return row ? profileFromRow(row) : undefined;
}

export function upsertBusinessProfile(
  workspaceId: string,
  partial: BusinessProfileUpdate
): BusinessProfile {
  const db = getDb();
  ensureProfileRow(workspaceId);

  const sets: string[] = [];
  const values: Record<string, unknown> = {
    workspaceId,
    updatedAt: Date.now(),
  };

  if (partial.businessName !== undefined) {
    sets.push("business_name = @businessName");
    values.businessName = partial.businessName;
  }
  if (partial.offerings !== undefined) {
    sets.push("offerings = @offerings");
    values.offerings = JSON.stringify(partial.offerings);
  }
  if (partial.serviceGeographies !== undefined) {
    sets.push("service_geographies = @serviceGeographies");
    values.serviceGeographies = JSON.stringify(partial.serviceGeographies);
  }
  if (partial.targetIndustries !== undefined) {
    sets.push("target_industries = @targetIndustries");
    values.targetIndustries = JSON.stringify(partial.targetIndustries);
  }
  if (partial.personaTitles !== undefined) {
    sets.push("persona_titles = @personaTitles");
    values.personaTitles = JSON.stringify(partial.personaTitles);
  }
  if (partial.companySizeMin !== undefined) {
    sets.push("company_size_min = @companySizeMin");
    values.companySizeMin = partial.companySizeMin;
  }
  if (partial.companySizeMax !== undefined) {
    sets.push("company_size_max = @companySizeMax");
    values.companySizeMax = partial.companySizeMax;
  }
  if (partial.dealSizeMin !== undefined) {
    sets.push("deal_size_min = @dealSizeMin");
    values.dealSizeMin = partial.dealSizeMin;
  }
  if (partial.dealSizeMax !== undefined) {
    sets.push("deal_size_max = @dealSizeMax");
    values.dealSizeMax = partial.dealSizeMax;
  }
  if (partial.excludedSegments !== undefined) {
    sets.push("excluded_segments = @excludedSegments");
    values.excludedSegments = JSON.stringify(partial.excludedSegments);
  }
  if (partial.messagingTone !== undefined) {
    sets.push("messaging_tone = @messagingTone");
    values.messagingTone = partial.messagingTone;
  }
  if (partial.complianceBoundaries !== undefined) {
    sets.push("compliance_boundaries = @complianceBoundaries");
    values.complianceBoundaries = JSON.stringify(partial.complianceBoundaries);
  }

  if (sets.length === 0) {
    db.prepare(
      `UPDATE workspace_business_profiles SET updated_at = @updatedAt WHERE workspace_id = @workspaceId`
    ).run(values);
  } else {
    db.prepare(
      `UPDATE workspace_business_profiles
       SET ${sets.join(", ")}, updated_at = @updatedAt
       WHERE workspace_id = @workspaceId`
    ).run(values);
  }

  return getBusinessProfile(workspaceId)!;
}

export function resetBusinessProfileToDefaults(workspaceId: string): BusinessProfile {
  const db = getDb();
  ensureProfileRow(workspaceId);
  const now = Date.now();
  db.prepare(
    `UPDATE workspace_business_profiles
       SET business_name = '',
           offerings = '[]',
           service_geographies = '[]',
           target_industries = '[]',
           persona_titles = '[]',
           company_size_min = NULL,
           company_size_max = NULL,
           deal_size_min = NULL,
           deal_size_max = NULL,
           excluded_segments = '[]',
           messaging_tone = NULL,
           compliance_boundaries = '{}',
           updated_at = ?
     WHERE workspace_id = ?`
  ).run(now, workspaceId);

  return getBusinessProfile(workspaceId)!;
}

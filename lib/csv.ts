import Papa from "papaparse";
import type { EnrichmentRow } from "./job-store";

export function parseCSV(content: string): { headers: string[]; rows: Record<string, string>[] } {
  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
  });
  const headers = result.meta.fields ?? [];
  return { headers, rows: result.data };
}

export function serializeCSV(rows: Record<string, string>[], headers: string[]): string {
  return Papa.unparse(rows, { columns: headers });
}

export function mergeEnrichedRows(
  enrichedRows: EnrichmentRow[],
  requestedFields: string[]
): { mergedRows: Record<string, string>[]; headers: string[] } {
  if (enrichedRows.length === 0) return { mergedRows: [], headers: [] };

  const originalHeaders = Object.keys(enrichedRows[0].originalData);
  const newHeaders = requestedFields.filter((f) => !originalHeaders.includes(f));
  const headers = [...originalHeaders, ...newHeaders];

  const mergedRows = enrichedRows.map((row) => {
    const merged: Record<string, string> = { ...row.originalData };
    for (const field of requestedFields) {
      merged[field] = row.enrichedData[field] ?? "";
    }
    return merged;
  });

  return { mergedRows, headers };
}

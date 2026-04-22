import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/job-store";
import { mergeEnrichedRows, serializeCSV } from "@/lib/csv";
import {
  DEFAULT_MAX_FLATTENED_CHANNELS,
  flattenChannels,
  flattenedChannelHeaders,
} from "@/lib/channels/flatten";
import { parseChannels } from "@/lib/channels/schema";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const job = getJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const { mergedRows, headers } = mergeEnrichedRows(job.rows, job.requestedFields);

  // For lead_score jobs, sort by total_score descending and prepend a Rank column
  // so the downloaded CSV is already a prioritised list.
  let finalRows = mergedRows;
  let finalHeaders = headers;
  if (job.type === "lead_score") {
    const scored = mergedRows.map((row, originalIdx) => {
      const s = Number(row.total_score);
      return { row, originalIdx, score: Number.isFinite(s) ? s : -1 };
    });
    scored.sort((a, b) => {
      if (a.score >= 0 && b.score < 0) return -1;
      if (b.score >= 0 && a.score < 0) return 1;
      return b.score - a.score;
    });
    finalRows = scored.map(({ row, score }, i) => ({
      Rank: score >= 0 ? String(i + 1) : "",
      ...row,
    }));
    finalHeaders = ["Rank", ...headers];
  }

  // For multi_channel jobs, replace the opaque "channels" JSON column with a
  // flat ranked column set (channel_1_type, channel_1_value, …) so CSV users
  // can sort / filter without touching JSON. The raw structured payload is
  // preserved in channels_json for advanced consumers.
  if (job.type === "multi_channel") {
    const channelHeaders = flattenedChannelHeaders(DEFAULT_MAX_FLATTENED_CHANNELS);
    finalHeaders = [
      ...finalHeaders.filter((h) => h !== "channels"),
      ...channelHeaders,
    ];
    finalRows = mergedRows.map((row) => {
      const channels = parseChannels(safeJsonParse(row.channels));
      const flat = flattenChannels(channels, DEFAULT_MAX_FLATTENED_CHANNELS);
      const next: Record<string, string> = { ...row };
      delete next.channels;
      return { ...next, ...flat };
    });
  }

  const csv = serializeCSV(finalRows, finalHeaders);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="enriched-${job.type}-${jobId.slice(0, 8)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

function safeJsonParse(s: string | undefined): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

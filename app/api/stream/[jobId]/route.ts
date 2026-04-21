import { NextRequest } from "next/server";
import { getJob, type EnrichmentRow, type Job } from "@/lib/job-store";
import { getJobBus } from "@/lib/job-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TERMINAL: Job["status"][] = ["completed", "failed", "cancelled"];

function snapshotPayload(job: Job) {
  const percentComplete =
    job.totalRows > 0 ? Math.round((job.processedRows / job.totalRows) * 100) : 0;
  return {
    jobId: job.id,
    type: job.type,
    status: job.status,
    totalRows: job.totalRows,
    processedRows: job.processedRows,
    percentComplete,
    requestedFields: job.requestedFields,
    identifierColumn: job.identifierColumn,
    rows: job.rows,
    error: job.error,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job) {
    return new Response("Job not found", { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const send = (event: string, data: unknown) => {
        safeEnqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      send("snapshot", snapshotPayload(job));

      if (TERMINAL.includes(job.status)) {
        send("end", { status: job.status });
        controller.close();
        return;
      }

      const bus = getJobBus(jobId);
      const onRow = (row: EnrichmentRow) => send("row", row);
      const onJob = (partial: Partial<Job>) => {
        const fresh = getJob(jobId);
        const percentComplete =
          fresh && fresh.totalRows > 0
            ? Math.round((fresh.processedRows / fresh.totalRows) * 100)
            : undefined;
        send("job", { ...partial, percentComplete });
        if (partial.status && TERMINAL.includes(partial.status)) {
          send("end", { status: partial.status });
        }
      };
      const onEnd = () => {
        cleanup();
        closed = true;
        try { controller.close(); } catch {}
      };

      bus.on("row", onRow);
      bus.on("job", onJob);
      bus.on("end", onEnd);

      const heartbeat = setInterval(() => safeEnqueue(`: keepalive\n\n`), 15000);

      const cleanup = () => {
        clearInterval(heartbeat);
        bus.off("row", onRow);
        bus.off("job", onJob);
        bus.off("end", onEnd);
      };

      request.signal.addEventListener("abort", () => {
        cleanup();
        closed = true;
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

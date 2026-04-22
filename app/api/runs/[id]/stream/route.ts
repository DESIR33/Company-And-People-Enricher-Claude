import { NextRequest } from "next/server";
import { getRun, getRunBus, listLeadsByRun } from "@/lib/monitor-store";

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const run = getRun(id);
  if (!run) return new Response("Not found", { status: 404 });

  const bus = getRunBus(id);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const write = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      // Initial snapshot
      write("run", run);
      write("leads", listLeadsByRun(id));

      const onRun = (r: unknown) => write("run", r);
      const onEnd = () => {
        write("leads", listLeadsByRun(id));
        controller.close();
      };

      bus.on("run", onRun);
      bus.on("end", onEnd);

      // Periodic refresh of lead list (cheap) for live counters
      const timer = setInterval(() => write("leads", listLeadsByRun(id)), 3000);

      const cleanup = () => {
        clearInterval(timer);
        bus.off("run", onRun);
        bus.off("end", onEnd);
      };

      // Close handler on client disconnect
      (controller as unknown as { signal?: AbortSignal }).signal?.addEventListener(
        "abort",
        cleanup
      );
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

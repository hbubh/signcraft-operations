import { MongoClient } from "mongodb";
import { api, actor } from "@/server/http";
import { db } from "@/server/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const GET = api(async (request) => {
  const user = await actor();
  const client = new MongoClient(process.env.DATABASE_URL!);
  await client.connect();
  const changes = client
    .db()
    .collection("OrderEvent")
    .watch([{ $match: { operationType: "insert" } }]);
  const encoder = new TextEncoder();
  let stopped = false;
  let heartbeat: ReturnType<typeof setInterval>;
  let deadline: ReturnType<typeof setTimeout>;
  let closeStream: () => void = () => {};
  const close = async () => {
    if (stopped) return;
    stopped = true;
    clearInterval(heartbeat);
    clearTimeout(deadline);
    await changes.close();
    await client.close();
    closeStream();
  };
  const stream = new ReadableStream({
    start(controller) {
      closeStream = () => {
        try {
          controller.close();
        } catch {}
      };
      const send = (type: string, data: unknown) => {
        if (!stopped)
          controller.enqueue(
            encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`),
          );
      };
      send("ready", { serverNow: new Date().toISOString() });
      heartbeat = setInterval(() => {
        if (!stopped) controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, 15000);
      deadline = setTimeout(() => void close(), 50000);
      request.signal.addEventListener("abort", () => void close(), {
        once: true,
      });
      void (async () => {
        try {
          for await (const change of changes) {
            if (stopped) break;
            if (!("fullDocument" in change) || !change.fullDocument) continue;
            const id = String(change.fullDocument.orderId);
            const order = await db.order.findUnique({
              where: { id },
              select: { vendorId: true, status: true },
            });
            if (!order) continue;
            const visible =
              user.role === "MANAGER" ||
              (user.role === "VENDOR" && order.vendorId === user.id) ||
              (user.role === "INSTALLER" &&
                ["READY_FOR_INSTALL", "COMPLETED"].includes(order.status));
            // Only an invalidation signal is emitted: never PII, assets, claim IDs, or event bodies.
            if (visible)
              send("invalidate", {
                scope: user.role === "INSTALLER" ? "jobs" : "orders",
              });
          }
        } catch {
          if (!stopped) send("unavailable", {});
        } finally {
          await close();
        }
      })();
    },
    cancel() {
      return close();
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
});

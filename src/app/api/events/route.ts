import { subscribe } from "@/server/bus";
import { getUserId } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const userId = await getUserId(req.headers);
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const enc = new TextEncoder();
  let off = () => {};
  let hb: ReturnType<typeof setInterval>;
  const stream = new ReadableStream({
    start(controller) {
      const send = (s: string) => { try { controller.enqueue(enc.encode(s)); } catch {} };
      send(`retry: 3000\n\n`);
      send(`data: ${JSON.stringify({ type: "hello" })}\n\n`);
      off = subscribe(userId, (e) => send(`data: ${JSON.stringify(e)}\n\n`));
      hb = setInterval(() => send(`: ping\n\n`), 25_000);
      req.signal.addEventListener("abort", () => { off(); clearInterval(hb); try { controller.close(); } catch {} });
    },
    cancel() { off(); clearInterval(hb); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
}

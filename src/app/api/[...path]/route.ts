import { ZodError } from "zod";
import { matchRoute } from "@/server/api";
import { checkOrigin, getUserId } from "@/server/session";
import { HttpError } from "@/server/mail/accounts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  try {
    const m = matchRoute(req.method, "/" + path.join("/"));
    if (!m) throw new HttpError(404, "Not found");
    checkOrigin(req);
    let userId = "";
    if (!m.route.pub) {
      const u = await getUserId(req.headers);
      if (!u) throw new HttpError(401, "Not signed in");
      userId = u;
    }
    const url = new URL(req.url);
    const out = await m.route.handler({
      userId, req, url, params: m.params,
      body: async <T,>() => (await req.json()) as T,
    });
    return Response.json(out ?? { ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof ZodError) return Response.json({ error: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
    if (e instanceof SyntaxError) return Response.json({ error: "Invalid JSON" }, { status: 400 });
    console.error("[api]", req.method, path.join("/"), e);
    return Response.json({ error: (e as Error).message || "Internal error" }, { status: 500 });
  }
}

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };

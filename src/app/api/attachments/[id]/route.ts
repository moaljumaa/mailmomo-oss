import { getUserId } from "@/server/session";
import { getAttachmentContent } from "@/server/mail/service";
import { HttpError } from "@/server/mail/accounts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Types that are safe to render inline in the browser; everything else is forced to download.
const INLINE_OK = /^(image\/(png|jpe?g|gif|webp|avif)|application\/pdf|text\/plain)$/i;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(req.headers);
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  try {
    const a = await getAttachmentContent(userId, id);
    const wantInline = new URL(req.url).searchParams.get("inline") === "1" || true;
    const inline = wantInline && INLINE_OK.test(a.contentType);
    const safeName = encodeURIComponent(a.filename);
    return new Response(new Uint8Array(a.content), {
      headers: {
        "content-type": inline ? a.contentType : "application/octet-stream",
        "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${safeName}`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "cache-control": "private, max-age=3600",
      },
    });
  } catch (e) {
    if (e instanceof HttpError) return new Response(e.message, { status: e.status });
    return new Response((e as Error).message, { status: 500 });
  }
}

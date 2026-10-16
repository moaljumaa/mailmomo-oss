import { auth, authReady } from "./auth";
import { HttpError } from "./mail/accounts";

export async function getUserId(headers: Headers): Promise<string | null> {
  await authReady();
  const s = await auth().api.getSession({ headers });
  return s?.user?.id ?? null;
}

export async function requireUserId(headers: Headers): Promise<string> {
  const id = await getUserId(headers);
  if (!id) throw new HttpError(401, "Not signed in");
  return id;
}

/** Defense in depth against CSRF: state-changing browser requests must originate from our own host. */
export function checkOrigin(req: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser client (no ambient cookies to abuse)
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  let oh = "";
  try { oh = new URL(origin).host; } catch {}
  const extra = (process.env.TRUSTED_ORIGINS || "").split(",").filter(Boolean).map((o) => { try { return new URL(o).host; } catch { return o; } });
  if (oh !== host && !extra.includes(oh)) throw new HttpError(403, "Cross-origin request blocked");
}

const buckets = new Map<string, { n: number; reset: number }>();
export function rateLimit(key: string, max: number, windowMs = 60_000) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    return;
  }
  if (++b.n > max) throw new HttpError(429, "Too many requests — slow down a moment");
}

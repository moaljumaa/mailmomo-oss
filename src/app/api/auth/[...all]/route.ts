import { toNextJsHandler } from "better-auth/next-js";
import { auth, authReady } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const h = () => toNextJsHandler(auth());
export async function GET(req: Request) {
  await authReady();
  return h().GET(req);
}
export async function POST(req: Request) {
  await authReady();
  return h().POST(req);
}

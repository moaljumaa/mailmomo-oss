import { handleMcp } from "@/server/mcp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) { return handleMcp(req); }
export async function GET(req: Request) { return handleMcp(req); }
export async function DELETE(req: Request) { return handleMcp(req); }

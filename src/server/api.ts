import { z } from "zod";
import * as svc from "./mail/service";
import * as ai from "./ai/features";
import { aiAvailable } from "./ai/client";
import { runAgent } from "./ai/agent";
import { activeModel, listModels, setActiveModel, usageSummary } from "./ai/models";
import { cleanupSuggestions } from "./cleanup";
import { createToken, listTokens, revokeToken } from "./tokens";
import { hasUsers } from "./auth";
import { rateLimit } from "./session";
import { HttpError } from "./mail/accounts";
import { parseWhen } from "@/lib/when";
import { db } from "./db";
import type { ThreadAction } from "./mail/service";

export type Ctx = { userId: string; req: Request; url: URL; params: Record<string, string>; body: <T = unknown>() => Promise<T> };
type Handler = (c: Ctx) => unknown | Promise<unknown>;
type Route = { method: string; re: RegExp; keys: string[]; handler: Handler; pub?: boolean };

const routes: Route[] = [];
function add(method: string, path: string, handler: Handler, opts: { pub?: boolean } = {}) {
  const keys: string[] = [];
  const re = new RegExp("^" + path.replace(/:(\w+)/g, (_m, k) => { keys.push(k); return "([^/]+)"; }) + "/?$");
  routes.push({ method, re, keys, handler, pub: opts.pub });
}
const get = (p: string, h: Handler, o?: { pub?: boolean }) => add("GET", p, h, o);
const post = (p: string, h: Handler) => add("POST", p, h);
const patch = (p: string, h: Handler) => add("PATCH", p, h);
const del = (p: string, h: Handler) => add("DELETE", p, h);

export function matchRoute(method: string, path: string) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(path);
    if (m) return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

const aiGuard = (c: Ctx) => {
  if (!svc.getSettings(c.userId).aiEnabled) throw new HttpError(403, "AI is turned off in settings");
  if (!aiAvailable()) throw new HttpError(503, "AI is not configured on this server (set LLM_API_KEY)");
  rateLimit(`ai:${c.userId}`, 40);
};

/* public */
get("/health", () => ({ ok: true }), { pub: true });
get("/setup", () => ({ needsSetup: !hasUsers() }), { pub: true });

/* accounts */
get("/accounts", (c) => svc.listAccounts(c.userId));
post("/accounts", async (c) => svc.addAccount(c.userId, await c.body()));
post("/accounts/test", async (c) => {
  rateLimit(`acct-test:${c.userId}`, 10);
  const i = svc.accountInput.parse(await c.body());
  return svc.verifyAccountConfig({ ...i, imapPort: i.imapPort ?? 993, imapSecure: i.imapSecure ?? true, smtpPort: i.smtpPort ?? 587, smtpSecure: i.smtpSecure ?? false });
});
patch("/accounts/:id", async (c) => svc.updateAccount(c.userId, c.params.id, await c.body()));
del("/accounts/:id", (c) => { svc.deleteAccount(c.userId, c.params.id); return { ok: true }; });
post("/sync", async (c) => svc.syncNow(c.userId, c.url.searchParams.get("accountId") ?? undefined));

/* folders + counts */
get("/folders", (c) => svc.listFolders(c.userId, c.url.searchParams.get("accountId") ?? undefined));
get("/counts", (c) => svc.inboxCounts(c.userId, c.url.searchParams.get("accountId") ?? undefined));

/* lists */
get("/threads", (c) => {
  const p = c.url.searchParams;
  const flag = (k: string) => (p.get(k) === "1" || p.get(k) === "true" ? true : undefined);
  return svc.listThreads(c.userId, {
    accountId: p.get("accountId") || undefined, folder: p.get("folder") || undefined,
    category: (p.get("category") as never) || undefined, label: p.get("label") || undefined, q: p.get("q") || undefined,
    unread: flag("unread"), starred: flag("starred"), snoozed: flag("snoozed"), needsReply: flag("needsReply"),
    limit: p.get("limit") ? Number(p.get("limit")) : undefined, offset: p.get("offset") ? Number(p.get("offset")) : undefined,
  });
});
get("/threads/:id", (c) => svc.getThread(c.userId, c.params.id));
get("/messages/:id", (c) => svc.getMessage(c.userId, c.params.id));

const actionSchema = z.object({
  ids: z.array(z.string()).min(1).max(500),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.enum(["read", "unread", "star", "unstar", "archive", "trash", "spam", "inbox", "delete_forever"]) }),
    z.object({ type: z.literal("move"), folder: z.string() }),
    z.object({ type: z.literal("snooze"), until: z.union([z.number(), z.string(), z.null()]) }),
    z.object({ type: z.enum(["label", "unlabel"]), name: z.string().min(1).max(40) }),
  ]),
  folderId: z.string().optional(),
});
post("/actions", async (c) => {
  const b = actionSchema.parse(await c.body());
  let action = b.action as ThreadAction;
  if (b.action.type === "snooze") {
    const u = b.action.until;
    const until = u === null ? null : typeof u === "number" ? u : parseWhen(u);
    if (u !== null && !until) throw new HttpError(400, "Invalid snooze time");
    action = { type: "snooze", until };
  }
  return { affected: svc.actOnThreads(c.userId, b.ids, action, { folderId: b.folderId }) };
});

/* labels */
get("/labels", (c) => svc.listLabels(c.userId));
post("/labels", async (c) => { const b = z.object({ name: z.string().min(1).max(40), color: z.string().optional() }).parse(await c.body()); return svc.createLabel(c.userId, b.name, b.color); });
patch("/labels/:id", async (c) => { svc.updateLabel(c.userId, c.params.id, z.object({ name: z.string().optional(), color: z.string().optional() }).parse(await c.body())); return { ok: true }; });
del("/labels/:id", (c) => { svc.deleteLabel(c.userId, c.params.id); return { ok: true }; });

/* rules */
get("/rules", (c) => svc.listRules(c.userId));
post("/rules", async (c) => svc.createRule(c.userId, await c.body()));
patch("/rules/:id", async (c) => svc.updateRule(c.userId, c.params.id, await c.body()));
del("/rules/:id", (c) => { svc.deleteRule(c.userId, c.params.id); return { ok: true }; });
post("/rules/:id/run", (c) => ({ matched: svc.runRuleNow(c.userId, c.params.id) }));

/* drafts */
get("/drafts", (c) => svc.listDrafts(c.userId));
post("/drafts", async (c) => svc.createDraft(c.userId, await c.body()));
post("/drafts/reply", async (c) => {
  const b = z.object({ messageId: z.string(), mode: z.enum(["reply", "reply_all", "forward"]) }).parse(await c.body());
  return svc.createReplyDraft(c.userId, b.messageId, b.mode);
});
get("/drafts/:id", (c) => ({ ...svc.getDraft(c.userId, c.params.id), files: svc.draftFiles(c.userId, c.params.id) }));
patch("/drafts/:id", async (c) => svc.updateDraft(c.userId, c.params.id, await c.body()));
del("/drafts/:id", (c) => { svc.deleteDraft(c.userId, c.params.id); return { ok: true }; });
post("/drafts/:id/send", async (c) => {
  const b = (await c.body<{ delaySeconds?: number; at?: number | string | null }>().catch(() => ({}))) as { delaySeconds?: number; at?: number | string | null };
  const at = typeof b.at === "string" ? parseWhen(b.at) ?? undefined : b.at ?? undefined;
  return svc.sendDraft(c.userId, c.params.id, { delaySeconds: b.delaySeconds, at });
});
post("/drafts/:id/cancel", (c) => { svc.cancelSend(c.userId, c.params.id); return { ok: true }; });
post("/drafts/:id/files", async (c) => {
  const form = await c.req.formData();
  const f = form.get("file");
  if (!(f instanceof File)) throw new HttpError(400, "file required");
  return svc.saveUpload(c.userId, { name: f.name, type: f.type, data: Buffer.from(await f.arrayBuffer()) }, c.params.id);
});
del("/uploads/:id", (c) => { svc.removeUpload(c.userId, c.params.id); return { ok: true }; });

get("/contacts", (c) => svc.suggestContacts(c.userId, c.url.searchParams.get("q") ?? ""));
get("/settings", (c) => ({ ...svc.getSettings(c.userId), _ai: aiAvailable() }));
patch("/settings", async (c) => {
  const b = z.object({
    aiEnabled: z.boolean(), autoTriage: z.boolean(), undoSendSeconds: z.number().int().min(0).max(60), theme: z.enum(["system", "light", "dark"]),
    density: z.enum(["comfortable", "compact"]), readingPane: z.boolean(), defaultAccountId: z.string().nullable(), loadRemoteImages: z.boolean(),
    splitTabs: z.array(z.enum(["primary", "updates", "newsletters", "promotions", "social"])),
  }).partial().parse(await c.body());
  return svc.updateSettings(c.userId, b);
});
post("/unsubscribe", async (c) => svc.unsubscribe(c.userId, z.object({ messageId: z.string() }).parse(await c.body()).messageId));
post("/contacts/trust-images", async (c) => {
  const b = z.object({ email: z.string().email() }).parse(await c.body());
  db().prepare("INSERT INTO contacts (user_id, email, name, count, last_seen, load_images) VALUES (?,?, '', 1, unixepoch(), 1) ON CONFLICT(user_id, email) DO UPDATE SET load_images = 1").run(c.userId, b.email.toLowerCase());
  return { ok: true };
});
get("/contacts/trusted-images", (c) => (db().prepare("SELECT email FROM contacts WHERE user_id = ? AND load_images = 1").all(c.userId) as { email: string }[]).map((r) => r.email));

/* tokens (MCP) */
get("/tokens", (c) => listTokens(c.userId));
post("/tokens", async (c) => {
  const b = z.object({ name: z.string().min(1).max(60), scopes: z.array(z.enum(["read", "write", "send"])).min(1) }).parse(await c.body());
  return createToken(c.userId, b.name, b.scopes);
});
del("/tokens/:id", (c) => { revokeToken(c.userId, c.params.id); return { ok: true }; });
get("/audit", (c) => db().prepare("SELECT actor, action, detail, at FROM audit_log WHERE user_id = ? ORDER BY id DESC LIMIT 100").all(c.userId));

/* cleanup */
get("/cleanup", (c) => cleanupSuggestions(c.userId));
post("/cleanup/apply", async (c) => {
  const b = z.object({ id: z.string() }).parse(await c.body());
  const s = cleanupSuggestions(c.userId).find((x) => x.id === b.id);
  if (!s) throw new HttpError(404, "Suggestion no longer applies");
  const threads = svc.listThreads(c.userId, { q: s.query, folder: "inbox", limit: 200 }).threads;
  return { affected: svc.actOnThreads(c.userId, threads.map((t) => t.threadId), { type: s.action === "read" ? "read" : s.action === "trash" ? "trash" : "archive" }) };
});

/* AI */
get("/ai/status", (c) => ({ available: aiAvailable(), enabled: svc.getSettings(c.userId).aiEnabled }));
get("/ai/models", async () => {
  if (!aiAvailable()) throw new HttpError(503, "AI is not configured on this server (set LLM_API_KEY)");
  try {
    return { active: activeModel(), models: await listModels() };
  } catch (e) {
    throw new HttpError(502, (e as Error).message);
  }
});
patch("/ai/model", async (c) => {
  const b = z.object({ model: z.string().min(1).max(200) }).parse(await c.body());
  try {
    await setActiveModel(b.model);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  return { active: b.model };
});
get("/ai/usage", (c) => usageSummary(Math.min(365, Math.max(1, Number(c.url.searchParams.get("days")) || 30))));
post("/ai/triage",async (c) => { aiGuard(c); return ai.triageNow(c.userId, z.object({ id: z.string() }).parse(await c.body()).id); });
post("/ai/summarize", async (c) => { aiGuard(c); return { summary: await ai.summarizeThread(c.userId, z.object({ id: z.string() }).parse(await c.body()).id) }; });
post("/ai/reply", async (c) => {
  aiGuard(c);
  const b = z.object({ messageId: z.string(), tone: z.enum(ai.TONES).optional(), instruction: z.string().max(500).optional(), replyAll: z.boolean().optional() }).parse(await c.body());
  return ai.aiReplyDraft(c.userId, b.messageId, b);
});
post("/ai/reply-text", async (c) => {
  aiGuard(c);
  const b = z.object({ messageId: z.string(), tone: z.enum(ai.TONES).optional(), instruction: z.string().max(500).optional() }).parse(await c.body());
  return { text: await ai.draftReplyText(c.userId, b.messageId, b) };
});
post("/ai/compose", async (c) => { aiGuard(c); const b = z.object({ prompt: z.string().min(1).max(1000), to: z.string().optional(), subject: z.string().optional() }).parse(await c.body()); return ai.composeFromPrompt(c.userId, b.prompt, b); });
post("/ai/rewrite", async (c) => { aiGuard(c); const b = z.object({ text: z.string().min(1).max(20000), mode: z.enum(ai.REWRITE_MODES) }).parse(await c.body()); return { text: await ai.rewriteText(b.text, b.mode) }; });
post("/ai/search", async (c) => { aiGuard(c); return ai.nlToQuery(c.userId, z.object({ text: z.string().min(1).max(500) }).parse(await c.body()).text); });
post("/ai/rule", async (c) => { aiGuard(c); return ai.nlToRule(z.object({ text: z.string().min(1).max(1000) }).parse(await c.body()).text); });
post("/ai/agent", async (c) => {
  aiGuard(c);
  const b = z.object({ messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).min(1).max(30) }).parse(await c.body());
  return runAgent(c.userId, b.messages);
});

import { z } from "zod";
import { db } from "./db";
import * as svc from "./mail/service";
import { parseWhen } from "@/lib/when";
import * as ai from "./ai/features";
import { aiAvailable } from "./ai/client";
import { cleanupSuggestions } from "./cleanup";
import type { ThreadSummary, MessageDTO } from "@/lib/types";

/**
 * One tool registry, three consumers: the MCP server, the in-app AI agent, and tests.
 * Scopes: read < write < send. `ai` tools additionally need an API key.
 */
export type Scope = "read" | "write" | "send";
export type ToolCtx = { userId: string; actor: string; scopes: Set<Scope> };
export type ToolDef = {
  name: string;
  description: string;
  scope: Scope;
  needsAi?: boolean;
  shape: z.ZodRawShape;
  handler: (ctx: ToolCtx, args: never) => Promise<unknown> | unknown;
};

const iso = (s: number) => new Date(s * 1000).toISOString();

export function compactThread(t: ThreadSummary) {
  return {
    id: t.id, threadId: t.threadId, accountId: t.accountId,
    from: t.fromName ? `${t.fromName} <${t.fromAddr}>` : t.fromAddr,
    subject: t.subject, snippet: t.snippet.slice(0, 200), date: iso(t.date),
    unread: !t.seen, starred: t.flagged, replied: t.answered, attachments: t.hasAttachments, messages: t.count,
    category: t.category, priority: t.priority, aiSummary: t.summary, needsReply: t.needsReply,
    labels: t.labels.map((l) => l.name), snoozedUntil: t.snoozedUntil ? iso(t.snoozedUntil) : null,
  };
}

export function compactMessage(m: MessageDTO, maxBody = 20000) {
  return {
    id: m.id, threadId: m.threadId, accountId: m.accountId, messageId: m.messageId,
    from: m.from, to: m.to, cc: m.cc, subject: m.subject, date: iso(m.date), unread: !m.seen, starred: m.flagged,
    folder: m.folderRole, category: m.category, labels: m.labels.map((l) => l.name), aiSummary: m.summary,
    attachments: m.attachments.map((a) => ({ id: a.id, filename: a.filename, contentType: a.contentType, size: a.size })),
    body: m.bodyText.length > maxBody ? m.bodyText.slice(0, maxBody) + "\n[truncated]" : m.bodyText,
  };
}

const addr = z.union([z.string(), z.object({ name: z.string().optional(), address: z.string() })]);
function toAddrs(a: z.infer<typeof addr>[] | undefined) {
  return (a ?? []).map((x) => {
    if (typeof x !== "string") return { name: x.name ?? "", address: x.address.trim().toLowerCase() };
    const m = x.match(/^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/);
    return m ? { name: (m[1] || "").trim(), address: m[2].trim().toLowerCase() } : { name: "", address: x.trim().toLowerCase() };
  });
}

const ids = z.array(z.string()).min(1).max(100).describe("Thread ids or message ids (as returned by list/search tools)");
const listShape = {
  folder: z.string().optional().describe("inbox | sent | drafts | trash | junk | archive | all | folder id (default inbox, or everywhere when searching)"),
  accountId: z.string().optional(), category: z.enum(["all", "primary", "updates", "newsletters", "promotions", "social"]).optional(),
  label: z.string().optional(), unread: z.boolean().optional(), starred: z.boolean().optional(), needsReply: z.boolean().optional(),
  query: z.string().optional().describe("Search syntax: from:x to:x subject:x has:attachment is:unread label:x category:x in:folder after:YYYY-MM-DD before:YYYY-MM-DD, plus free text"),
  limit: z.number().int().min(1).max(100).optional(), offset: z.number().int().min(0).optional(),
};

export const tools: ToolDef[] = [
  /* ---------------- read ---------------- */
  { name: "list_accounts", scope: "read", description: "List connected mail accounts (id, name, email).", shape: {},
    handler: (c) => svc.listAccounts(c.userId).map((a) => ({ id: a.id, name: a.name, email: a.email, syncState: a.syncState, lastSyncedAt: a.lastSyncedAt })) },
  { name: "list_folders", scope: "read", description: "List folders with unread/total counts.", shape: { accountId: z.string().optional() },
    handler: (c, a: { accountId?: string }) => svc.listFolders(c.userId, a.accountId) },
  { name: "list_messages", scope: "read", description: "List email threads (newest first) with optional filters or a search query. Returns compact summaries incl. AI category, priority and summary.", shape: listShape,
    handler: (c, a: z.infer<z.ZodObject<typeof listShape>>) => {
      const r = svc.listThreads(c.userId, { folder: a.folder, accountId: a.accountId, category: a.category, label: a.label, unread: a.unread, starred: a.starred, needsReply: a.needsReply, q: a.query, limit: a.limit ?? 25, offset: a.offset });
      return { threads: r.threads.map(compactThread), hasMore: r.hasMore };
    } },
  { name: "search_messages", scope: "read", description: "Full-text search across all mail. Supports operators like from:, to:, subject:, has:attachment, is:unread, label:, category:, in:, after:, before:.", shape: { query: z.string().min(1), limit: z.number().int().min(1).max(100).optional() },
    handler: (c, a: { query: string; limit?: number }) => ({ threads: svc.listThreads(c.userId, { q: a.query, limit: a.limit ?? 25 }).threads.map(compactThread) }) },
  { name: "get_message", scope: "read", description: "Get one email with its full text body and attachment list.", shape: { id: z.string(), maxBodyChars: z.number().int().min(500).max(100000).optional() },
    handler: (c, a: { id: string; maxBodyChars?: number }) => compactMessage(svc.getMessage(c.userId, a.id), a.maxBodyChars) },
  { name: "get_thread", scope: "read", description: "Get all messages of a thread in chronological order.", shape: { id: z.string(), maxBodyChars: z.number().int().min(500).max(50000).optional() },
    handler: (c, a: { id: string; maxBodyChars?: number }) => {
      const t = svc.getThread(c.userId, a.id);
      return { threadId: t.threadId, subject: t.subject, accountId: t.accountId, messages: t.messages.map((m) => compactMessage(m, a.maxBodyChars ?? 6000)) };
    } },
  { name: "inbox_stats", scope: "read", description: "Unread counts by category plus needs-reply and snoozed totals.", shape: { accountId: z.string().optional() },
    handler: (c, a: { accountId?: string }) => svc.inboxCounts(c.userId, a.accountId) },
  { name: "list_labels", scope: "read", description: "List labels with thread counts.", shape: {}, handler: (c) => svc.listLabels(c.userId) },
  { name: "list_rules", scope: "read", description: "List automation rules.", shape: {}, handler: (c) => svc.listRules(c.userId) },
  { name: "list_drafts", scope: "read", description: "List unsent drafts.", shape: {}, handler: (c) => svc.listDrafts(c.userId) },
  { name: "cleanup_suggestions", scope: "read", description: "Suggest bulk clean-ups (e.g. archive old newsletters) with the search query that selects them.", shape: {},
    handler: (c) => cleanupSuggestions(c.userId) },

  /* ---------------- AI-assisted (read scope) ---------------- */
  { name: "summarize_thread", scope: "read", needsAi: true, description: "AI summary of a thread with a possible action item.", shape: { id: z.string() },
    handler: async (c, a: { id: string }) => ({ summary: await ai.summarizeThread(c.userId, a.id) }) },
  { name: "natural_language_search", scope: "read", needsAi: true, description: "Translate a plain-English request into search syntax and run it.", shape: { request: z.string(), limit: z.number().int().min(1).max(100).optional() },
    handler: async (c, a: { request: string; limit?: number }) => {
      const q = await ai.nlToQuery(c.userId, a.request);
      return { query: q.query, explanation: q.explanation, threads: svc.listThreads(c.userId, { q: q.query, limit: a.limit ?? 25 }).threads.map(compactThread) };
    } },

  /* ---------------- write ---------------- */
  { name: "mark_read", scope: "write", description: "Mark threads/messages as read.", shape: { ids }, handler: (c, a: { ids: string[] }) => ({ affected: svc.actOnThreads(c.userId, a.ids, { type: "read" }) }) },
  { name: "mark_unread", scope: "write", description: "Mark threads/messages as unread.", shape: { ids }, handler: (c, a: { ids: string[] }) => ({ affected: svc.actOnThreads(c.userId, a.ids, { type: "unread" }) }) },
  { name: "star", scope: "write", description: "Star threads.", shape: { ids }, handler: (c, a: { ids: string[] }) => ({ affected: svc.actOnThreads(c.userId, a.ids, { type: "star" }) }) },
  { name: "unstar", scope: "write", description: "Remove star.", shape: { ids }, handler: (c, a: { ids: string[] }) => ({ affected: svc.actOnThreads(c.userId, a.ids, { type: "unstar" }) }) },
  { name: "archive", scope: "write", description: "Archive threads (move out of the inbox).", shape: { ids }, handler: (c, a: { ids: string[] }) => ({ affected: svc.actOnThreads(c.userId, a.ids, { type: "archive" }) }) },
  { name: "trash", scope: "write", description: "Move threads to trash.", shape: { ids }, handler: (c, a: { ids: string[] }) => ({ affected: svc.actOnThreads(c.userId, a.ids, { type: "trash" }) }) },
  { name: "mark_spam", scope: "write", description: "Move threads to the junk folder.", shape: { ids }, handler: (c, a: { ids: string[] }) => ({ affected: svc.actOnThreads(c.userId, a.ids, { type: "spam" }) }) },
  { name: "move_to_folder", scope: "write", description: "Move threads to a folder (role or folder id/path).", shape: { ids, folder: z.string() }, handler: (c, a: { ids: string[]; folder: string }) => ({ affected: svc.actOnThreads(c.userId, a.ids, { type: "move", folder: a.folder }) }) },
  { name: "snooze", scope: "write", description: "Hide threads from the inbox until a time. `until` accepts ISO date or: 3h, 2d, 1w, tomorrow, later today, weekend, next week. Pass null to un-snooze.", shape: { ids, until: z.string().nullable() },
    handler: (c, a: { ids: string[]; until: string | null }) => {
      const t = a.until === null ? null : parseWhen(a.until);
      if (a.until !== null && !t) throw new Error(`Could not understand time: ${a.until}`);
      return { affected: svc.actOnThreads(c.userId, a.ids, { type: "snooze", until: t }), until: t ? iso(t) : null };
    } },
  { name: "add_label", scope: "write", description: "Add a label (created if missing) to threads.", shape: { ids, label: z.string().min(1).max(40) }, handler: (c, a: { ids: string[]; label: string }) => ({ affected: svc.actOnThreads(c.userId, a.ids, { type: "label", name: a.label }) }) },
  { name: "remove_label", scope: "write", description: "Remove a label from threads.", shape: { ids, label: z.string() }, handler: (c, a: { ids: string[]; label: string }) => ({ affected: svc.actOnThreads(c.userId, a.ids, { type: "unlabel", name: a.label }) }) },
  { name: "create_label", scope: "write", description: "Create a label.", shape: { name: z.string().min(1).max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }, handler: (c, a: { name: string; color?: string }) => svc.createLabel(c.userId, a.name, a.color) },
  { name: "create_draft", scope: "write", description: "Create an unsent draft (visible in the Mailmomo composer). `body` is plain text. Use inReplyToMessageId to make it a reply.",
    shape: { accountId: z.string().optional(), to: z.array(addr).optional(), cc: z.array(addr).optional(), bcc: z.array(addr).optional(), subject: z.string().optional(), body: z.string(), inReplyToMessageId: z.string().optional() },
    handler: (c, a: { accountId?: string; to?: z.infer<typeof addr>[]; cc?: z.infer<typeof addr>[]; bcc?: z.infer<typeof addr>[]; subject?: string; body: string; inReplyToMessageId?: string }) => {
      const d = svc.createDraft(c.userId, { accountId: a.accountId, to: toAddrs(a.to), cc: toAddrs(a.cc), bcc: toAddrs(a.bcc), subject: a.subject ?? "", bodyHtml: svc.textToHtml(a.body), bodyText: a.body, inReplyToMessageId: a.inReplyToMessageId });
      return { draftId: d.id, status: d.status };
    } },
  { name: "create_reply_draft", scope: "write", description: "Create a reply (or reply-all / forward) draft with quoted history, optionally prefilled with `body` text.", shape: { messageId: z.string(), mode: z.enum(["reply", "reply_all", "forward"]).optional(), body: z.string().optional() },
    handler: (c, a: { messageId: string; mode?: "reply" | "reply_all" | "forward"; body?: string }) => {
      let d = svc.createReplyDraft(c.userId, a.messageId, a.mode ?? "reply");
      if (a.body) d = svc.updateDraft(c.userId, d.id, { bodyHtml: d.bodyHtml.replace("<p></p>", svc.textToHtml(a.body)) });
      return { draftId: d.id, to: d.to, subject: d.subject };
    } },
  { name: "update_draft", scope: "write", description: "Edit an existing draft.", shape: { draftId: z.string(), to: z.array(addr).optional(), cc: z.array(addr).optional(), subject: z.string().optional(), body: z.string().optional() },
    handler: (c, a: { draftId: string; to?: z.infer<typeof addr>[]; cc?: z.infer<typeof addr>[]; subject?: string; body?: string }) => {
      const d = svc.updateDraft(c.userId, a.draftId, { ...(a.to ? { to: toAddrs(a.to) } : {}), ...(a.cc ? { cc: toAddrs(a.cc) } : {}), ...(a.subject !== undefined ? { subject: a.subject } : {}), ...(a.body !== undefined ? { bodyHtml: svc.textToHtml(a.body), bodyText: a.body } : {}) });
      return { draftId: d.id };
    } },
  { name: "delete_draft", scope: "write", description: "Delete a draft.", shape: { draftId: z.string() }, handler: (c, a: { draftId: string }) => { svc.deleteDraft(c.userId, a.draftId); return { ok: true }; } },
  { name: "create_rule", scope: "write", description: "Create an inbox automation rule applied to new mail. Fields: from,to,subject,body,category,has_attachment,list,account. Actions: label,archive,mark_read,star,trash,move,set_category.",
    shape: { name: z.string(), conditions: z.array(z.object({ field: z.enum(["from", "to", "subject", "body", "category", "has_attachment", "list", "account"]), op: z.enum(["contains", "equals", "not_contains", "is_true"]).optional(), value: z.string().optional() })).min(1),
      actions: z.array(z.object({ type: z.enum(["label", "archive", "mark_read", "star", "trash", "move", "set_category"]), value: z.string().optional() })).min(1), matchAll: z.boolean().optional(), applyNow: z.boolean().optional() },
    handler: (c, a: { name: string; conditions: { field: string; op?: string; value?: string }[]; actions: { type: string; value?: string }[]; matchAll?: boolean; applyNow?: boolean }) => {
      const r = svc.createRule(c.userId, { name: a.name, matchAll: a.matchAll ?? true, conditions: a.conditions.map((x) => ({ ...x, op: x.op ?? "contains" })), actions: a.actions });
      const applied = a.applyNow ? svc.runRuleNow(c.userId, r.id) : undefined;
      return { ruleId: r.id, appliedToExisting: applied };
    } },
  { name: "create_rule_from_text", scope: "write", needsAi: true, description: "Create a rule from a plain-English description.", shape: { description: z.string() },
    handler: async (c, a: { description: string }) => { const r = await ai.nlToRule(a.description); return svc.createRule(c.userId, r); } },
  { name: "set_rule_enabled", scope: "write", description: "Enable or disable a rule.", shape: { ruleId: z.string(), enabled: z.boolean() }, handler: (c, a: { ruleId: string; enabled: boolean }) => svc.updateRule(c.userId, a.ruleId, { enabled: a.enabled }) },
  { name: "delete_rule", scope: "write", description: "Delete a rule.", shape: { ruleId: z.string() }, handler: (c, a: { ruleId: string }) => { svc.deleteRule(c.userId, a.ruleId); return { ok: true }; } },
  { name: "run_rule_now", scope: "write", description: "Apply a rule to existing inbox mail.", shape: { ruleId: z.string() }, handler: (c, a: { ruleId: string }) => ({ matched: svc.runRuleNow(c.userId, a.ruleId) }) },
  { name: "draft_reply_with_ai", scope: "write", needsAi: true, description: "Have the AI write a reply draft (not sent) for a message.", shape: { messageId: z.string(), instruction: z.string().optional(), tone: z.enum(["concise", "friendly", "formal", "direct"]).optional(), replyAll: z.boolean().optional() },
    handler: async (c, a: { messageId: string; instruction?: string; tone?: "concise" | "friendly" | "formal" | "direct"; replyAll?: boolean }) => { const d = await ai.aiReplyDraft(c.userId, a.messageId, a); return { draftId: d.id, to: d.to, subject: d.subject }; } },
  { name: "delete_permanently", scope: "write", description: "Permanently delete threads that are already in the trash. Irreversible.", shape: { ids }, handler: (c, a: { ids: string[] }) => ({ affected: svc.actOnThreads(c.userId, a.ids, { type: "delete_forever" }) }) },

  /* ---------------- send ---------------- */
  { name: "send_email", scope: "send", description: "Compose and send a new email immediately via SMTP. `body` is plain text.",
    shape: { accountId: z.string().optional(), to: z.array(addr).min(1), cc: z.array(addr).optional(), bcc: z.array(addr).optional(), subject: z.string(), body: z.string() },
    handler: async (c, a: { accountId?: string; to: z.infer<typeof addr>[]; cc?: z.infer<typeof addr>[]; bcc?: z.infer<typeof addr>[]; subject: string; body: string }) =>
      svc.composeAndSend(c.userId, { accountId: a.accountId, to: toAddrs(a.to), cc: toAddrs(a.cc), bcc: toAddrs(a.bcc), subject: a.subject, body: a.body }) },
  { name: "send_draft", scope: "send", description: "Send an existing draft immediately.", shape: { draftId: z.string() }, handler: (c, a: { draftId: string }) => svc.sendDraftNow(c.userId, a.draftId) },
  { name: "reply", scope: "send", description: "Reply to a message and send immediately. `body` is plain text (quoted history is appended).", shape: { messageId: z.string(), body: z.string(), replyAll: z.boolean().optional() },
    handler: async (c, a: { messageId: string; body: string; replyAll?: boolean }) => {
      const d = svc.createReplyDraft(c.userId, a.messageId, a.replyAll ? "reply_all" : "reply");
      svc.updateDraft(c.userId, d.id, { bodyHtml: d.bodyHtml.replace("<p></p>", svc.textToHtml(a.body)) });
      await svc.sendDraftNow(c.userId, d.id);
      return { ok: true, to: d.to };
    } },
  { name: "forward", scope: "send", description: "Forward a message to new recipients and send immediately, with an optional note.", shape: { messageId: z.string(), to: z.array(addr).min(1), note: z.string().optional() },
    handler: async (c, a: { messageId: string; to: z.infer<typeof addr>[]; note?: string }) => {
      const d = svc.createReplyDraft(c.userId, a.messageId, "forward");
      svc.updateDraft(c.userId, d.id, { to: toAddrs(a.to), bodyHtml: a.note ? d.bodyHtml.replace("<p></p>", svc.textToHtml(a.note)) : d.bodyHtml });
      await svc.sendDraftNow(c.userId, d.id);
      return { ok: true };
    } },
];

export const WRITE_SCOPES: Scope[] = ["read", "write"];

export function allowed(ctx: ToolCtx, t: ToolDef): boolean {
  if (t.needsAi && !aiAvailable()) return false;
  if (t.scope === "read") return ctx.scopes.has("read");
  if (t.scope === "write") return ctx.scopes.has("write");
  return ctx.scopes.has("send");
}

export async function runTool(ctx: ToolCtx, name: string, args: unknown): Promise<unknown> {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`Unknown tool: ${name}`);
  if (!allowed(ctx, t)) throw new Error(`Tool ${name} not permitted for this token/context (needs ${t.scope}${t.needsAi ? " + AI" : ""})`);
  const parsed = z.object(t.shape).parse(args ?? {});
  const out = await t.handler(ctx, parsed as never);
  if (t.scope !== "read") {
    db().prepare("INSERT INTO audit_log (user_id, actor, action, detail) VALUES (?,?,?,?)").run(ctx.userId, ctx.actor, name, JSON.stringify(args).slice(0, 500));
  }
  return out;
}

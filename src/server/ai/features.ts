import { z } from "zod";
import { db } from "../db";
import { publish } from "../bus";
import { aiAvailable, complete, structured, untrusted, INJECTION_NOTE, AiUnavailableError } from "./client";
import { CATEGORIES, type RuleDTO } from "@/lib/types";
import { addLabel } from "../mail/rules";
import { getMessage, getThread, getSettings, listLabels, HttpError, createDraft, textToHtml, createReplyDraft, updateDraft, listAccounts, listFolders } from "../mail/service";
import type { MsgRow } from "../mail/rows";

/* ------------------------------------ triage ------------------------------------ */

const triageItem = z.object({
  id: z.string(),
  category: z.enum(CATEGORIES),
  priority: z.number().int().min(0).max(3).describe("0 ignore, 1 low, 2 normal/important, 3 urgent/time-sensitive and from a real person"),
  summary: z.string().max(160).describe("One short sentence capturing what this email is about / asks"),
  needs_reply: z.boolean().describe("true only if a real person expects a reply from the user"),
  labels: z.array(z.string().max(30)).max(2).describe("0-2 short topical labels, reuse existing labels when they fit"),
});
const triageSchema = z.object({ items: z.array(triageItem) });

const TRIAGE_SYSTEM = `You triage a busy person's inbox. For every email decide:
- category: primary (real people & important personal/work conversations), updates (receipts, invoices, notifications, security alerts, shipping), newsletters (subscribed content), promotions (marketing, sales), social (social networks & communities).
- priority 0-3, a one-sentence summary, whether the user needs to reply, and up to 2 short labels (Title Case, 1-2 words, e.g. "Finance", "Travel", "Client"). Prefer existing labels.
${INJECTION_NOTE}`;

export function triageCandidates(limit = 8): (MsgRow & { user_id: string })[] {
  return db()
    .prepare(
      `SELECT m.*, a.user_id FROM messages m JOIN mail_accounts a ON a.id = m.account_id
       WHERE m.ai_state = 'pending' AND m.uid > 0 ORDER BY m.date DESC LIMIT ?`,
    )
    .all(limit) as (MsgRow & { user_id: string })[];
}

export async function triageMessages(userId: string, rows: MsgRow[]): Promise<number> {
  if (!rows.length) return 0;
  const existing = listLabels(userId).map((l) => l.name);
  const user = [
    `Existing labels: ${existing.join(", ") || "(none)"}`,
    ...rows.map((r) =>
      untrusted(
        `email id="${r.id}"`,
        `From: ${r.from_name} <${r.from_addr}>\nSubject: ${r.subject}\nHas List-Unsubscribe: ${r.list_unsubscribe ? "yes" : "no"}\nCurrent guess: ${r.category}\n\n${(r.body_text ?? r.snippet).slice(0, 1800)}`,
        2400,
      ),
    ),
  ].join("\n\n");
  const out = await structured({ schema: triageSchema, name: "record_triage", description: "Record triage results for every email", system: TRIAGE_SYSTEM, user, model: "fast", maxTokens: 2500 });
  const byId = new Map(out.items.map((i) => [i.id, i]));
  const upd = db().prepare("UPDATE messages SET category = ?, priority = ?, summary = ?, needs_reply = ?, ai_state = 'done' WHERE id = ?");
  let n = 0;
  for (const r of rows) {
    const t = byId.get(r.id);
    if (!t) {
      db().prepare("UPDATE messages SET ai_state = 'error' WHERE id = ?").run(r.id);
      continue;
    }
    upd.run(t.category, t.priority, t.summary, t.needs_reply ? 1 : 0, r.id);
    for (const l of t.labels) if (l.trim()) addLabel(userId, r.id, l.trim(), "ai");
    publish(userId, { type: "ai", messageId: r.id });
    n++;
  }
  return n;
}

/** One pass of the background triage worker. Returns number of messages processed. */
export async function triageTick(): Promise<number> {
  if (!aiAvailable()) return 0;
  const cands = triageCandidates(8);
  if (!cands.length) return 0;
  const byUser = new Map<string, MsgRow[]>();
  for (const c of cands) {
    const s = getSettings(c.user_id);
    const recent = c.date > Date.now() / 1000 - 14 * 86400;
    if (!s.aiEnabled || !s.autoTriage || !recent) {
      db().prepare("UPDATE messages SET ai_state = 'skipped' WHERE id = ?").run(c.id);
      continue;
    }
    byUser.set(c.user_id, [...(byUser.get(c.user_id) ?? []), c]);
  }
  let n = 0;
  for (const [u, rows] of byUser) {
    try {
      n += await triageMessages(u, rows);
    } catch (e) {
      db().prepare(`UPDATE messages SET ai_state = 'error' WHERE id IN (${rows.map(() => "?").join(",")})`).run(...rows.map((r) => r.id));
      console.error("[ai] triage failed:", (e as Error).message);
    }
  }
  return n;
}

export async function triageNow(userId: string, messageId: string) {
  const m = getMessage(userId, messageId);
  const row = db().prepare("SELECT * FROM messages WHERE id = ?").get(m.id) as MsgRow;
  await triageMessages(userId, [row]);
  return getMessage(userId, messageId);
}

/* ------------------------------------ thread summary ------------------------------------ */

export async function summarizeThread(userId: string, threadId: string): Promise<string> {
  const t = getThread(userId, threadId);
  const transcript = t.messages
    .map((m) => `From: ${m.from.name || m.from.address} | ${new Date(m.date * 1000).toISOString().slice(0, 16)}\n${m.bodyText.slice(0, 1500)}`)
    .join("\n---\n");
  return complete({
    system: `Summarize email threads for a busy executive: 2-4 short bullet points (use "- "), then if an action is needed from the user a final line starting with "Action:". Be concrete (names, dates, amounts). ${INJECTION_NOTE}`,
    user: `Subject: ${t.subject}\n${untrusted("thread", transcript, 12000)}`,
    model: "fast",
    maxTokens: 500,
  });
}

/* ------------------------------------ drafting ------------------------------------ */

export const TONES = ["concise", "friendly", "formal", "direct"] as const;

export async function draftReplyText(userId: string, messageId: string, opts: { tone?: (typeof TONES)[number]; instruction?: string } = {}): Promise<string> {
  const t = getThread(userId, messageId);
  const last = t.messages.at(-1)!;
  const transcript = t.messages.slice(-6).map((m) => `From: ${m.from.name || m.from.address}\n${m.bodyText.slice(0, 1500)}`).join("\n---\n");
  const acct = listAccounts(userId).find((a) => a.id === t.accountId);
  return complete({
    system: `You write email replies on behalf of ${acct?.name ?? "the user"} (${acct?.email ?? ""}). Output ONLY the reply body as plain text, no subject, no quoted history, no signature. Match the language of the thread. Tone: ${opts.tone ?? "concise"}. Be brief and specific. If information is missing, write a sensible reply that asks for it rather than inventing facts. ${INJECTION_NOTE}`,
    user: `${untrusted("thread", transcript, 9000)}\n\nWrite a reply to the last message from ${last.from.name || last.from.address}.${opts.instruction ? `\nUser instruction: ${opts.instruction}` : ""}`,
    maxTokens: 700,
  });
}

/** Create a reply draft with an AI-written body. The user reviews and sends it. */
export async function aiReplyDraft(userId: string, messageId: string, opts: { tone?: (typeof TONES)[number]; instruction?: string; replyAll?: boolean } = {}) {
  const text = await draftReplyText(userId, messageId, opts);
  const d = createReplyDraft(userId, messageId, opts.replyAll ? "reply_all" : "reply");
  const withBody = d.bodyHtml.replace("<p></p>", textToHtml(text));
  return updateDraft(userId, d.id, { bodyHtml: withBody });
}

export async function composeFromPrompt(userId: string, prompt: string, ctx: { to?: string; subject?: string } = {}) {
  const out = await structured({
    schema: z.object({ subject: z.string().max(200), body: z.string() }),
    name: "write_email",
    description: "Return the email subject and plain-text body",
    system: "You write clear, human emails from a short instruction. Plain text body, no placeholders unless information is truly missing (then use [brackets]). Match the language of the instruction. Keep it as short as the intent allows.",
    user: `Instruction: ${prompt}\n${ctx.to ? `Recipient: ${ctx.to}\n` : ""}${ctx.subject ? `Subject hint: ${ctx.subject}\n` : ""}`,
    maxTokens: 900,
  });
  return out;
}

export const REWRITE_MODES = ["improve", "shorten", "lengthen", "formal", "friendly", "fix"] as const;
export async function rewriteText(text: string, mode: (typeof REWRITE_MODES)[number]): Promise<string> {
  const how: Record<string, string> = {
    improve: "Improve clarity and flow while keeping the meaning and voice.",
    shorten: "Make it much shorter without losing key information.",
    lengthen: "Expand slightly with useful detail, keep it natural.",
    formal: "Make the tone more formal and professional.",
    friendly: "Make the tone warmer and friendlier.",
    fix: "Fix spelling and grammar only; change nothing else.",
  };
  return complete({ system: `Rewrite the user's email text. ${how[mode]} Output only the rewritten text, preserving paragraph breaks and language.`, user: text.slice(0, 8000), maxTokens: 1500, model: "fast" });
}

/* ------------------------------------ natural language → query / rule ------------------------------------ */

export async function nlToQuery(userId: string, text: string): Promise<{ query: string; explanation: string }> {
  const labels = listLabels(userId).map((l) => l.name).join(", ");
  const today = new Date().toISOString().slice(0, 10);
  return structured({
    schema: z.object({ query: z.string(), explanation: z.string().max(140) }),
    name: "build_query",
    description: "Return a search query in Mailmomo syntax",
    system: `Translate a natural-language mailbox request into Mailmomo search syntax. Operators: from:x to:x subject:"multi word" has:attachment is:unread|read|starred|snoozed|needsreply label:Name category:primary|updates|newsletters|promotions|social in:inbox|sent|drafts|trash|junk|archive|anywhere after:YYYY-MM-DD before:YYYY-MM-DD (also relative like after:7d, after:2m) -from:x to exclude. Remaining words are full-text. Today is ${today}. Known labels: ${labels || "none"}. Prefer few, precise operators.`,
    user: text,
    model: "fast",
    maxTokens: 300,
  });
}

const aiRule = z.object({
  name: z.string().max(80),
  matchAll: z.boolean(),
  conditions: z.array(z.object({ field: z.enum(["from", "to", "subject", "body", "category", "has_attachment", "list", "account"]), op: z.enum(["contains", "equals", "not_contains", "is_true"]), value: z.string().optional() })).min(1),
  actions: z.array(z.object({ type: z.enum(["label", "archive", "mark_read", "star", "trash", "move", "set_category"]), value: z.string().optional() })).min(1),
});

export async function nlToRule(text: string): Promise<Omit<RuleDTO, "id" | "hits" | "enabled"> & { enabled: boolean }> {
  const r = await structured({
    schema: aiRule,
    name: "build_rule",
    description: "Return an inbox automation rule",
    system: `Convert the user's request into an inbox rule. Conditions fields: from (name or address substring), to, subject, body, category (primary|updates|newsletters|promotions|social), has_attachment (op is_true), list (op is_true: has List-Unsubscribe header), account. Ops: contains, equals, not_contains, is_true. Actions: label(value=name), archive, mark_read, star, trash, move(value=folder role or name), set_category(value=category). Rules apply to new incoming mail. Use matchAll=true unless the user says "or".`,
    user: text,
    model: "fast",
    maxTokens: 500,
  });
  const actions = r.actions.map((a) => (a.value !== undefined ? { type: a.type, value: a.value } : { type: a.type })) as RuleDTO["actions"];
  return { name: r.name, enabled: true, matchAll: r.matchAll, conditions: r.conditions, actions, sourceText: text };
}

export { AiUnavailableError, HttpError, listFolders, createDraft };

import fs from "node:fs";
import path from "node:path";
import { simpleParser } from "mailparser";
import { z } from "zod";
import { db, tx } from "../db";
import { uid, encrypt } from "../crypto";
import { DATA_DIR } from "../env";
import { publish } from "../bus";
import {
  HttpError, accountPasswords, toAccountDTO, userAccount, userAccounts, type AccountRow,
} from "./accounts";
import { buildSearchSql, parseQuery } from "./search";
import { labelsFor, toMessageDTO, toThreadSummary, folderRole, parseAddrs, type MsgRow } from "./rows";
import {
  archiveMessage, deleteForever, ensureFolder, getMsg, moveMessage, setFlags, trashMessage,
} from "./ops";
import { addLabel, getOrCreateLabel, matches, runActions } from "./rules";
import { deliver } from "./smtp";
import { makeClient, startAccountSync, stopAccountSync, syncAccountOnce, testImap } from "./sync";
import { testSmtp } from "./smtp";
import { wake } from "./wake";
import { htmlToText } from "./parse";
import {
  DEFAULT_SETTINGS, type Addr, type DraftDTO, type FolderDTO, type FolderRole, type LabelDTO, type ListQuery, type MessageDTO, type RuleAction,
  type RuleCondition, type RuleDTO, type Settings, type ThreadDTO, type ThreadSummary,
} from "@/lib/types";

export { HttpError };

/* ---------------------------------- accounts ---------------------------------- */

export const accountInput = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  imapHost: z.string().min(1),
  imapPort: z.number().int().min(1).max(65535).optional(),
  imapSecure: z.boolean().optional(),
  imapUser: z.string().min(1),
  imapPass: z.string().min(1),
  smtpHost: z.string().min(1),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().min(1),
  smtpPass: z.string().min(1),
  signature: z.string().max(5000).optional(),
  allowSelfSigned: z.boolean().optional(),
  skipVerify: z.boolean().optional(),
});
export type AccountInput = z.infer<typeof accountInput>;

/** Refuse link-local / cloud-metadata targets (SSRF). LAN and loopback hosts remain allowed for self-hosters. */
export async function assertSafeHost(host: string) {
  const { lookup } = await import("node:dns/promises");
  let addrs: { address: string }[] = [];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new HttpError(400, `Cannot resolve host ${host}`);
  }
  for (const a of addrs) {
    if (/^169\.254\./.test(a.address) || /^fe80:/i.test(a.address) || /^fd00:ec2::/i.test(a.address)) {
      throw new HttpError(400, `Host ${host} resolves to a link-local address, which is not allowed`);
    }
  }
}

export async function verifyAccountConfig(i: AccountInput & { imapPort: number; imapSecure: boolean; smtpPort: number; smtpSecure: boolean }) {
  await Promise.all([assertSafeHost(i.imapHost), assertSafeHost(i.smtpHost)]);
  const rejectUnauthorized = !i.allowSelfSigned;
  const res: { imap: string | null; smtp: string | null } = { imap: null, smtp: null };
  await Promise.all([
    testImap({ host: i.imapHost, port: i.imapPort, secure: i.imapSecure, user: i.imapUser, pass: i.imapPass, rejectUnauthorized }).catch((e) => { res.imap = (e as Error).message; }),
    testSmtp({ host: i.smtpHost, port: i.smtpPort, secure: i.smtpSecure, user: i.smtpUser, pass: i.smtpPass, rejectUnauthorized }).catch((e) => { res.smtp = (e as Error).message; }),
  ]);
  return res;
}

const ACCOUNT_COLORS = ["#6366f1", "#10b981", "#f97316", "#ec4899", "#0ea5e9", "#a855f7", "#eab308"];

export async function addAccount(userId: string, raw: unknown) {
  const parsed = accountInput.parse(raw);
  const i = { ...parsed, imapPort: parsed.imapPort ?? 993, imapSecure: parsed.imapSecure ?? true, smtpPort: parsed.smtpPort ?? 587, smtpSecure: parsed.smtpSecure ?? false };
  await Promise.all([assertSafeHost(i.imapHost), assertSafeHost(i.smtpHost)]);
  if (!i.skipVerify) {
    const v = await verifyAccountConfig(i);
    if (v.imap || v.smtp) throw new HttpError(400, [v.imap && `IMAP: ${v.imap}`, v.smtp && `SMTP: ${v.smtp}`].filter(Boolean).join(" · "));
  }
  const n = userAccounts(userId).length;
  const id = uid();
  db().prepare(
    `INSERT INTO mail_accounts (id, user_id, name, email, color, imap_host, imap_port, imap_secure, imap_user, imap_pass, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, signature, tls_reject_unauthorized, sort_order)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id, userId, i.name, i.email.toLowerCase(), i.color ?? ACCOUNT_COLORS[n % ACCOUNT_COLORS.length], i.imapHost, i.imapPort, i.imapSecure ? 1 : 0, i.imapUser, encrypt(i.imapPass),
    i.smtpHost, i.smtpPort, i.smtpSecure ? 1 : 0, i.smtpUser, encrypt(i.smtpPass), i.signature ?? "", i.allowSelfSigned ? 0 : 1, n,
  );
  startAccountSync(id);
  return toAccountDTO(userAccount(userId, id));
}

export async function updateAccount(userId: string, id: string, raw: Partial<AccountInput>) {
  const a = userAccount(userId, id);
  const p = accountInput.partial().parse(raw); // no defaults in the schema, so omitted fields stay untouched
  const sets: string[] = [];
  const vals: unknown[] = [];
  const set = (col: string, v: unknown) => { sets.push(`${col} = ?`); vals.push(v); };
  if (p.name !== undefined) set("name", p.name);
  if (p.email !== undefined) set("email", p.email.toLowerCase());
  if (p.color !== undefined) set("color", p.color);
  if (p.imapHost !== undefined) set("imap_host", p.imapHost);
  if (p.imapPort !== undefined) set("imap_port", p.imapPort);
  if (p.imapSecure !== undefined) set("imap_secure", p.imapSecure ? 1 : 0);
  if (p.imapUser !== undefined) set("imap_user", p.imapUser);
  if (p.imapPass) set("imap_pass", encrypt(p.imapPass));
  if (p.smtpHost !== undefined) set("smtp_host", p.smtpHost);
  if (p.smtpPort !== undefined) set("smtp_port", p.smtpPort);
  if (p.smtpSecure !== undefined) set("smtp_secure", p.smtpSecure ? 1 : 0);
  if (p.smtpUser !== undefined) set("smtp_user", p.smtpUser);
  if (p.smtpPass) set("smtp_pass", encrypt(p.smtpPass));
  if (p.signature !== undefined) set("signature", p.signature);
  if (p.allowSelfSigned !== undefined) set("tls_reject_unauthorized", p.allowSelfSigned ? 0 : 1);
  if (sets.length) db().prepare(`UPDATE mail_accounts SET ${sets.join(", ")} WHERE id = ?`).run(...vals, a.id);
  const connChanged = ["imap_host", "imap_port", "imap_secure", "imap_user", "imap_pass", "allowSelfSigned"].some((k) => sets.some((s) => s.startsWith(k)));
  if (connChanged) {
    stopAccountSync(id);
    startAccountSync(id);
  }
  return toAccountDTO(userAccount(userId, id));
}

export function deleteAccount(userId: string, id: string) {
  userAccount(userId, id);
  stopAccountSync(id);
  tx(() => {
    db().prepare("DELETE FROM pending_ops WHERE account_id = ?").run(id);
    db().prepare("DELETE FROM drafts WHERE account_id = ?").run(id);
    db().prepare("DELETE FROM mail_accounts WHERE id = ?").run(id);
  });
}

export function listAccounts(userId: string) {
  return userAccounts(userId).map(toAccountDTO);
}

export async function syncNow(userId: string, accountId?: string) {
  const ids = accountId ? [userAccount(userId, accountId).id] : userAccounts(userId).map((a) => a.id);
  for (const id of ids) wake(id);
  return { ok: true, accounts: ids.length };
}

/** Lazily fetch more history for a folder when the user scrolls past the synced window. */
export function requestBackfill(userId: string, accountId: string) {
  userAccount(userId, accountId);
  wake(accountId);
}

/* ---------------------------------- folders ---------------------------------- */

export function listFolders(userId: string, accountId?: string): FolderDTO[] {
  const accts = accountId ? [userAccount(userId, accountId)] : userAccounts(userId);
  if (!accts.length) return [];
  const rows = db()
    .prepare(
      `SELECT f.id, f.account_id, f.path, f.name, f.special_use,
        (SELECT COUNT(*) FROM messages m WHERE m.folder_id = f.id AND m.seen = 0 AND (m.snoozed_until IS NULL OR m.snoozed_until <= unixepoch())) unread,
        (SELECT COUNT(*) FROM messages m WHERE m.folder_id = f.id) total
       FROM folders f WHERE f.account_id IN (${accts.map(() => "?").join(",")}) ORDER BY f.account_id, CASE f.special_use WHEN 'inbox' THEN 0 WHEN 'drafts' THEN 1 WHEN 'sent' THEN 2 WHEN 'archive' THEN 3 WHEN 'junk' THEN 4 WHEN 'trash' THEN 5 ELSE 6 END, f.name`,
    )
    .all(...accts.map((a) => a.id)) as { id: string; account_id: string; path: string; name: string; special_use: string | null; unread: number; total: number }[];
  return rows.map((r) => ({ id: r.id, accountId: r.account_id, path: r.path, name: r.name, role: r.special_use as FolderRole, unread: r.unread, total: r.total }));
}

export function inboxCounts(userId: string, accountId?: string) {
  const accts = accountId ? [userAccount(userId, accountId)] : userAccounts(userId);
  if (!accts.length) return { unread: 0, byCategory: {} as Record<string, number>, needsReply: 0, snoozed: 0 };
  const ids = accts.map((a) => a.id);
  const ph = ids.map(() => "?").join(",");
  const rows = db()
    .prepare(
      `SELECT coalesce(m.category,'primary') cat, COUNT(*) c FROM messages m JOIN folders f ON f.id = m.folder_id
       WHERE m.account_id IN (${ph}) AND f.special_use = 'inbox' AND m.seen = 0 AND (m.snoozed_until IS NULL OR m.snoozed_until <= unixepoch()) GROUP BY cat`,
    )
    .all(...ids) as { cat: string; c: number }[];
  const byCategory: Record<string, number> = {};
  let unread = 0;
  for (const r of rows) {
    byCategory[r.cat] = r.c;
    unread += r.c;
  }
  const needsReply = (db().prepare(`SELECT COUNT(DISTINCT thread_id) c FROM messages m JOIN folders f ON f.id = m.folder_id WHERE m.account_id IN (${ph}) AND f.special_use='inbox' AND m.needs_reply = 1`).get(...ids) as { c: number }).c;
  const snoozed = (db().prepare(`SELECT COUNT(DISTINCT thread_id) c FROM messages WHERE account_id IN (${ph}) AND snoozed_until > unixepoch()`).get(...ids) as { c: number }).c;
  return { unread, byCategory, needsReply, snoozed };
}

/* ---------------------------------- lists / search ---------------------------------- */

function scopeAccounts(userId: string, accountId?: string): string[] {
  if (accountId) return [userAccount(userId, accountId).id];
  return userAccounts(userId).map((a) => a.id);
}

export function listThreads(userId: string, q: ListQuery = {}): { threads: ThreadSummary[]; hasMore: boolean } {
  const ids = scopeAccounts(userId, q.accountId);
  if (!ids.length) return { threads: [], hasMore: false };
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const offset = q.offset ?? 0;

  const pq = parseQuery(q.q ?? "");
  const sp = buildSearchSql(pq);
  const where: string[] = [`m.account_id IN (${ids.map(() => "?").join(",")})`, "m.uid IS NOT NULL"];
  const params: unknown[] = [...ids];
  const searching = !!(q.q && q.q.trim());

  // folder scope
  const folder = q.folder;
  if (folder && folder !== "all") {
    const roles = ["inbox", "sent", "drafts", "trash", "junk", "archive"];
    if (roles.includes(folder)) { where.push("f.special_use = ?"); params.push(folder); }
    else { where.push("f.id = ?"); params.push(folder); }
  } else if (!folder && !searching && !q.label && !q.starred && !q.snoozed && !q.needsReply) {
    where.push("f.special_use = 'inbox'");
  } else if (!sp.inRole && !q.folder) {
    // searches / label views span everything except trash & junk
    where.push("(f.special_use IS NULL OR f.special_use NOT IN ('trash','junk'))");
  }

  const isInboxView = (folder === "inbox" || (!folder && !searching && !q.label && !q.starred && !q.snoozed && !q.needsReply));
  if (q.snoozed) where.push("m.snoozed_until IS NOT NULL AND m.snoozed_until > unixepoch()");
  else if (isInboxView) where.push("(m.snoozed_until IS NULL OR m.snoozed_until <= unixepoch())");

  if (q.category && q.category !== "all") {
    if (q.category === "primary") where.push("(m.category = 'primary' OR m.category IS NULL)");
    else { where.push("m.category = ?"); params.push(q.category); }
  }
  if (q.unread) where.push("m.seen = 0");
  if (q.starred) where.push("m.flagged = 1");
  if (q.needsReply) where.push("m.needs_reply = 1");
  if (q.label) {
    where.push("EXISTS (SELECT 1 FROM message_labels ml JOIN labels l ON l.id = ml.label_id WHERE ml.message_id = m.id AND l.user_id = ? AND (l.id = ? OR lower(l.name) = lower(?)))");
    params.push(userId, q.label, q.label);
  }
  where.push(...sp.where);
  params.push(...sp.params);

  const sql = `
    WITH filt AS (
      SELECT m.id, m.thread_id, m.date FROM messages m JOIN folders f ON f.id = m.folder_id WHERE ${where.join(" AND ")}
    ), ranked AS (
      SELECT id, thread_id, date, ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY date DESC, id) rn FROM filt
    )
    SELECT id FROM ranked WHERE rn = 1 ORDER BY date DESC LIMIT ? OFFSET ?`;
  const idRows = db().prepare(sql).all(...params, limit + 1, offset) as { id: string }[];
  const hasMore = idRows.length > limit;
  const pageIds = idRows.slice(0, limit).map((r) => r.id);
  if (!pageIds.length) return { threads: [], hasMore: false };

  const ph = pageIds.map(() => "?").join(",");
  const rows = db()
    .prepare(
      `SELECT m.*, (SELECT COUNT(*) FROM messages x WHERE x.thread_id = m.thread_id) cnt,
              (SELECT COUNT(*) FROM messages x WHERE x.thread_id = m.thread_id AND x.seen = 0) unread_cnt,
              (SELECT COUNT(*) FROM messages x WHERE x.thread_id = m.thread_id AND x.answered = 1) ans_cnt,
              (SELECT group_concat(n, char(1)) FROM (SELECT DISTINCT CASE WHEN x.from_name != '' THEN x.from_name ELSE x.from_addr END n FROM messages x WHERE x.thread_id = m.thread_id ORDER BY x.date LIMIT 4)) people
       FROM messages m WHERE m.id IN (${ph}) ORDER BY m.date DESC`,
    )
    .all(...pageIds) as (MsgRow & { cnt: number; unread_cnt: number; ans_cnt: number; people: string | null })[];
  const lbl = labelsFor(rows.map((r) => r.id));
  return { threads: rows.map((r) => toThreadSummary(r, lbl.get(r.id) ?? [])), hasMore };
}

function ownedMessage(userId: string, id: string): MsgRow {
  const r = db()
    .prepare("SELECT m.* FROM messages m JOIN mail_accounts a ON a.id = m.account_id WHERE m.id = ? AND a.user_id = ?")
    .get(id, userId) as MsgRow | undefined;
  if (!r) throw new HttpError(404, "Message not found");
  return r;
}

export function getMessage(userId: string, id: string): MessageDTO {
  const r = ownedMessage(userId, id);
  return toMessageDTO(r, labelsFor([id]).get(id) ?? [], folderRole(r.folder_id));
}

export function getThread(userId: string, idOrThreadId: string): ThreadDTO {
  let rows = db()
    .prepare("SELECT m.* FROM messages m JOIN mail_accounts a ON a.id = m.account_id WHERE m.thread_id = ? AND a.user_id = ? ORDER BY m.date, m.rowid")
    .all(idOrThreadId, userId) as MsgRow[];
  if (!rows.length) {
    const m = ownedMessage(userId, idOrThreadId);
    rows = db().prepare("SELECT * FROM messages WHERE thread_id = ? ORDER BY date, rowid").all(m.thread_id) as MsgRow[];
  }
  if (!rows.length) throw new HttpError(404, "Thread not found");
  const lbl = labelsFor(rows.map((r) => r.id));
  const msgs = rows.map((r) => toMessageDTO(r, lbl.get(r.id) ?? [], folderRole(r.folder_id)));
  return { threadId: rows[0].thread_id, subject: rows[0].subject, accountId: rows[0].account_id, messages: msgs };
}

/* ---------------------------------- actions ---------------------------------- */

export type ThreadAction =
  | { type: "read" } | { type: "unread" } | { type: "star" } | { type: "unstar" }
  | { type: "archive" } | { type: "trash" } | { type: "spam" } | { type: "inbox" }
  | { type: "move"; folder: string }
  | { type: "snooze"; until: number | null }
  | { type: "label"; name: string } | { type: "unlabel"; name: string }
  | { type: "delete_forever" };

function threadMessages(userId: string, threadId: string): (MsgRow & { role: string | null })[] {
  return db()
    .prepare(
      `SELECT m.*, f.special_use role FROM messages m JOIN mail_accounts a ON a.id = m.account_id JOIN folders f ON f.id = m.folder_id WHERE m.thread_id = ? AND a.user_id = ? ORDER BY m.date`,
    )
    .all(threadId, userId) as (MsgRow & { role: string | null })[];
}

/** Apply an action to threads (or single messages, when ids resolve to a message). */
export function actOnThreads(userId: string, ids: string[], action: ThreadAction, opts: { folderId?: string } = {}): number {
  let n = 0;
  for (const raw of ids) {
    let msgs = threadMessages(userId, raw);
    if (!msgs.length) {
      const m = ownedMessage(userId, raw);
      msgs = threadMessages(userId, m.thread_id);
    }
    n += applyToMessages(userId, msgs, action, opts);
  }
  if (n) {
    const accts = new Set<string>();
    for (const raw of ids) {
      const m = db().prepare("SELECT account_id FROM messages WHERE thread_id = ? OR id = ? LIMIT 1").get(raw, raw) as { account_id: string } | undefined;
      if (m) accts.add(m.account_id);
    }
    for (const a of accts) publish(userId, { type: "mail", accountId: a, reason: `action:${action.type}` });
  }
  return n;
}

function applyToMessages(userId: string, msgs: (MsgRow & { role: string | null })[], action: ThreadAction, opts: { folderId?: string }): number {
  // messages that "live" in the mailbox view (not our own sent copies / drafts)
  const live = msgs.filter((m) => m.role !== "sent" && m.role !== "drafts" && m.role !== "trash");
  const inFolder = opts.folderId ? msgs.filter((m) => m.folder_id === opts.folderId) : live;
  const target = inFolder.length ? inFolder : live;
  let n = 0;
  switch (action.type) {
    case "read": case "unread":
      for (const m of msgs) { if (m.role === "drafts") continue; setFlags(m.id, { seen: action.type === "read" }); n++; }
      break;
    case "star": { const last = [...msgs].reverse().find((m) => m.role !== "drafts"); if (last) { setFlags(last.id, { flagged: true }); n++; } break; }
    case "unstar": for (const m of msgs) if (m.flagged) { setFlags(m.id, { flagged: false }); n++; } break;
    case "archive": for (const m of target.filter((x) => x.role === "inbox" || x.role === "junk" || x.role === null || x.role === "all")) { archiveMessage(m.id); n++; } break;
    case "trash": {
      const inTrash = msgs.filter((m) => m.role === "trash");
      const src = opts.folderId && inTrash.some((m) => m.folder_id === opts.folderId) ? inTrash : target;
      for (const m of src) { trashMessage(m.id); n++; }
      break;
    }
    case "delete_forever": for (const m of msgs.filter((x) => x.role === "trash")) { deleteForever(m.id); n++; } break;
    case "spam": for (const m of target) { moveMessage(m.id, ensureFolder(m.account_id, "junk").id); n++; } break;
    case "inbox": for (const m of msgs.filter((x) => x.role !== "sent" && x.role !== "drafts")) { moveMessage(m.id, ensureFolder(m.account_id, "inbox").id); n++; } break;
    case "move": {
      for (const m of target) {
        const roles = ["inbox", "sent", "drafts", "trash", "junk", "archive"];
        const dest = roles.includes(action.folder)
          ? ensureFolder(m.account_id, action.folder as Exclude<FolderRole, null>)
          : (db().prepare("SELECT id FROM folders WHERE account_id = ? AND (id = ? OR path = ?)").get(m.account_id, action.folder, action.folder) as { id: string } | undefined);
        if (dest) { moveMessage(m.id, dest.id); n++; }
      }
      break;
    }
    case "snooze":
      for (const m of msgs.filter((x) => x.role === "inbox" || x.snoozed_until)) {
        db().prepare("UPDATE messages SET snoozed_until = ? WHERE id = ?").run(action.until, m.id); n++;
      }
      break;
    case "label": for (const m of msgs) { addLabel(userId, m.id, action.name, "user"); n++; } break;
    case "unlabel":
      for (const m of msgs) {
        db().prepare("DELETE FROM message_labels WHERE message_id = ? AND label_id IN (SELECT id FROM labels WHERE user_id = ? AND lower(name) = lower(?))").run(m.id, userId, action.name); n++;
      }
      break;
  }
  return n;
}

/* ---------------------------------- labels ---------------------------------- */

export function listLabels(userId: string): (LabelDTO & { count: number })[] {
  return (db()
    .prepare(
      `SELECT l.id, l.name, l.color, (SELECT COUNT(DISTINCT m.thread_id) FROM message_labels ml JOIN messages m ON m.id = ml.message_id WHERE ml.label_id = l.id) count FROM labels l WHERE l.user_id = ? ORDER BY l.name`,
    )
    .all(userId) as LabelDTO[] & { count: number }[]) as (LabelDTO & { count: number })[];
}
export function createLabel(userId: string, name: string, color?: string) {
  const id = getOrCreateLabel(userId, name, color);
  if (color) db().prepare("UPDATE labels SET color = ? WHERE id = ?").run(color, id);
  return db().prepare("SELECT id, name, color FROM labels WHERE id = ?").get(id) as LabelDTO;
}
export function updateLabel(userId: string, id: string, p: { name?: string; color?: string }) {
  const l = db().prepare("SELECT * FROM labels WHERE id = ? AND user_id = ?").get(id, userId);
  if (!l) throw new HttpError(404, "Label not found");
  if (p.name) db().prepare("UPDATE labels SET name = ? WHERE id = ?").run(p.name.trim(), id);
  if (p.color) db().prepare("UPDATE labels SET color = ? WHERE id = ?").run(p.color, id);
}
export function deleteLabel(userId: string, id: string) {
  db().prepare("DELETE FROM labels WHERE id = ? AND user_id = ?").run(id, userId);
}

/* ---------------------------------- rules ---------------------------------- */

const ruleSchema = z.object({
  name: z.string().min(1).max(120),
  enabled: z.boolean().default(true),
  matchAll: z.boolean().default(true),
  conditions: z.array(z.object({
    field: z.enum(["from", "to", "subject", "body", "category", "has_attachment", "list", "account"]),
    op: z.enum(["contains", "equals", "not_contains", "is_true"]).default("contains"),
    value: z.string().optional(),
  })).min(1),
  actions: z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("label"), value: z.string().min(1) }),
    z.object({ type: z.literal("archive") }), z.object({ type: z.literal("mark_read") }),
    z.object({ type: z.literal("star") }), z.object({ type: z.literal("trash") }),
    z.object({ type: z.literal("move"), value: z.string().min(1) }),
    z.object({ type: z.literal("set_category"), value: z.enum(["primary", "updates", "newsletters", "promotions", "social"]) }),
  ])).min(1),
  sourceText: z.string().max(1000).nullish(),
});
export type RuleInput = z.infer<typeof ruleSchema>;

function toRuleDTO(r: { id: string; name: string; enabled: number; match_all: number; conditions: string; actions: string; source_text: string | null; hits: number }): RuleDTO {
  return { id: r.id, name: r.name, enabled: !!r.enabled, matchAll: !!r.match_all, conditions: JSON.parse(r.conditions) as RuleCondition[], actions: JSON.parse(r.actions) as RuleAction[], sourceText: r.source_text, hits: r.hits };
}
export function listRules(userId: string): RuleDTO[] {
  return (db().prepare("SELECT * FROM rules WHERE user_id = ? ORDER BY created_at").all(userId) as Parameters<typeof toRuleDTO>[0][]).map(toRuleDTO);
}
export function createRule(userId: string, raw: unknown): RuleDTO {
  const r = ruleSchema.parse(raw);
  const id = uid();
  db().prepare("INSERT INTO rules (id, user_id, name, enabled, match_all, conditions, actions, source_text) VALUES (?,?,?,?,?,?,?,?)")
    .run(id, userId, r.name, r.enabled ? 1 : 0, r.matchAll ? 1 : 0, JSON.stringify(r.conditions), JSON.stringify(r.actions), r.sourceText ?? null);
  return toRuleDTO(db().prepare("SELECT * FROM rules WHERE id = ?").get(id) as Parameters<typeof toRuleDTO>[0]);
}
export function updateRule(userId: string, id: string, raw: unknown): RuleDTO {
  const ex = db().prepare("SELECT id FROM rules WHERE id = ? AND user_id = ?").get(id, userId);
  if (!ex) throw new HttpError(404, "Rule not found");
  const r = ruleSchema.partial().parse(raw);
  if (r.name !== undefined) db().prepare("UPDATE rules SET name = ? WHERE id = ?").run(r.name, id);
  if (r.enabled !== undefined) db().prepare("UPDATE rules SET enabled = ? WHERE id = ?").run(r.enabled ? 1 : 0, id);
  if (r.matchAll !== undefined) db().prepare("UPDATE rules SET match_all = ? WHERE id = ?").run(r.matchAll ? 1 : 0, id);
  if (r.conditions) db().prepare("UPDATE rules SET conditions = ? WHERE id = ?").run(JSON.stringify(r.conditions), id);
  if (r.actions) db().prepare("UPDATE rules SET actions = ? WHERE id = ?").run(JSON.stringify(r.actions), id);
  return toRuleDTO(db().prepare("SELECT * FROM rules WHERE id = ?").get(id) as Parameters<typeof toRuleDTO>[0]);
}
export function deleteRule(userId: string, id: string) {
  db().prepare("DELETE FROM rules WHERE id = ? AND user_id = ?").run(id, userId);
}

/** Run a rule retroactively over existing inbox mail. Returns matched thread count. */
export function runRuleNow(userId: string, id: string): number {
  const rule = listRules(userId).find((r) => r.id === id);
  if (!rule) throw new HttpError(404, "Rule not found");
  const ids = userAccounts(userId).map((a) => a.id);
  if (!ids.length) return 0;
  const rows = db()
    .prepare(`SELECT m.*, a.email acc_email FROM messages m JOIN folders f ON f.id = m.folder_id JOIN mail_accounts a ON a.id = m.account_id WHERE m.account_id IN (${ids.map(() => "?").join(",")}) AND f.special_use = 'inbox'`)
    .all(...ids) as (MsgRow & { acc_email: string })[];
  let n = 0;
  for (const m of rows) {
    if (matches(rule, m, m.acc_email, !!m.list_unsubscribe)) { runActions(userId, m, rule.actions); n++; }
  }
  db().prepare("UPDATE rules SET hits = hits + ? WHERE id = ?").run(n, id);
  return n;
}

/* ---------------------------------- settings / contacts ---------------------------------- */

export function getSettings(userId: string): Settings {
  const r = db().prepare("SELECT json FROM settings WHERE user_id = ?").get(userId) as { json: string } | undefined;
  return { ...DEFAULT_SETTINGS, ...(r ? JSON.parse(r.json) : {}) };
}
export function updateSettings(userId: string, p: Partial<Settings>): Settings {
  const cur = getSettings(userId);
  const next = { ...cur, ...p };
  db().prepare("INSERT INTO settings (user_id, json) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json").run(userId, JSON.stringify(next));
  return next;
}

export function suggestContacts(userId: string, q: string, limit = 8): Addr[] {
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = db()
    .prepare("SELECT email, name FROM contacts WHERE user_id = ? AND (email LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\') ORDER BY count DESC, last_seen DESC LIMIT ?")
    .all(userId, like, like, limit) as { email: string; name: string }[];
  return rows.map((r) => ({ name: r.name, address: r.email }));
}

/* ---------------------------------- drafts & sending ---------------------------------- */

type DraftRow = {
  id: string; user_id: string; account_id: string; in_reply_to_message_id: string | null; to_json: string; cc_json: string; bcc_json: string;
  subject: string; body_html: string; body_text: string; send_at: number | null; status: string; error: string | null; updated_at: number;
};

function toDraftDTO(r: DraftRow): DraftDTO {
  return {
    id: r.id, accountId: r.account_id, inReplyToMessageId: r.in_reply_to_message_id, to: parseAddrs(r.to_json), cc: parseAddrs(r.cc_json), bcc: parseAddrs(r.bcc_json),
    subject: r.subject, bodyHtml: r.body_html, bodyText: r.body_text, sendAt: r.send_at, status: r.status, error: r.error, updatedAt: r.updated_at,
  };
}

const addrSchema = z.object({ name: z.string().default(""), address: z.string().email() });
export const draftInput = z.object({
  accountId: z.string().optional(),
  inReplyToMessageId: z.string().nullish(),
  to: z.array(addrSchema).optional(),
  cc: z.array(addrSchema).optional(),
  bcc: z.array(addrSchema).optional(),
  subject: z.string().max(998).optional(),
  bodyHtml: z.string().max(2_000_000).optional(),
  bodyText: z.string().max(1_000_000).optional(),
});
export type DraftInput = z.infer<typeof draftInput>;

function ownedDraft(userId: string, id: string): DraftRow {
  const r = db().prepare("SELECT * FROM drafts WHERE id = ? AND user_id = ?").get(id, userId) as DraftRow | undefined;
  if (!r) throw new HttpError(404, "Draft not found");
  return r;
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
export function textToHtml(t: string) {
  return t.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("");
}
function defaultAccount(userId: string, accountId?: string): AccountRow {
  if (accountId) return userAccount(userId, accountId);
  const pref = getSettings(userId).defaultAccountId;
  const list = userAccounts(userId);
  const a = list.find((x) => x.id === pref) ?? list[0];
  if (!a) throw new HttpError(400, "No mail account configured");
  return a;
}

export function createDraft(userId: string, raw: unknown = {}): DraftDTO {
  const i = draftInput.parse(raw);
  const acc = defaultAccount(userId, i.accountId);
  const id = uid();
  const sig = acc.signature ? `<p></p><div class="mm-sig">${textToHtml(acc.signature)}</div>` : "";
  const html = i.bodyHtml || sig;
  db().prepare(
    "INSERT INTO drafts (id, user_id, account_id, in_reply_to_message_id, to_json, cc_json, bcc_json, subject, body_html, body_text) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run(id, userId, acc.id, i.inReplyToMessageId ?? null, JSON.stringify(i.to ?? []), JSON.stringify(i.cc ?? []), JSON.stringify(i.bcc ?? []), i.subject ?? "", html, i.bodyText ?? htmlToText(html));
  return toDraftDTO(ownedDraft(userId, id));
}

export function updateDraft(userId: string, id: string, raw: unknown): DraftDTO {
  const d = ownedDraft(userId, id);
  if (d.status === "sending") throw new HttpError(409, "Draft is being sent");
  const i = draftInput.parse(raw);
  const acc = i.accountId ? userAccount(userId, i.accountId).id : d.account_id;
  const html = i.bodyHtml ?? d.body_html;
  db().prepare(
    "UPDATE drafts SET account_id = ?, to_json = ?, cc_json = ?, bcc_json = ?, subject = ?, body_html = ?, body_text = ?, status = 'draft', send_at = NULL, error = NULL, updated_at = unixepoch() WHERE id = ?",
  ).run(
    acc, JSON.stringify(i.to ?? parseAddrs(d.to_json)), JSON.stringify(i.cc ?? parseAddrs(d.cc_json)), JSON.stringify(i.bcc ?? parseAddrs(d.bcc_json)),
    i.subject ?? d.subject, html, i.bodyText ?? (i.bodyHtml !== undefined ? htmlToText(html) : d.body_text), id,
  );
  return toDraftDTO(ownedDraft(userId, id));
}

export function getDraft(userId: string, id: string) { return toDraftDTO(ownedDraft(userId, id)); }
export function listDrafts(userId: string): DraftDTO[] {
  return (db().prepare("SELECT * FROM drafts WHERE user_id = ? AND status IN ('draft','scheduled','failed','sending') ORDER BY updated_at DESC").all(userId) as DraftRow[]).map(toDraftDTO);
}
export function deleteDraft(userId: string, id: string) {
  ownedDraft(userId, id);
  const files = db().prepare("SELECT path FROM draft_files WHERE draft_id = ?").all(id) as { path: string }[];
  for (const f of files) fs.rm(f.path, { force: true }, () => {});
  db().prepare("DELETE FROM draft_files WHERE draft_id = ?").run(id);
  db().prepare("DELETE FROM drafts WHERE id = ?").run(id);
}

export function createReplyDraft(userId: string, messageId: string, mode: "reply" | "reply_all" | "forward"): DraftDTO {
  const m = ownedMessage(userId, messageId);
  const acc = userAccount(userId, m.account_id);
  const role = folderRole(m.folder_id);
  const own = new Set([acc.email.toLowerCase()]);
  const from: Addr = { name: m.from_name, address: m.from_addr };
  const to = parseAddrs(m.to_json);
  const cc = parseAddrs(m.cc_json);
  let rTo: Addr[] = [];
  let rCc: Addr[] = [];
  if (mode === "reply" || mode === "reply_all") {
    const primary: Addr = m.reply_to ? { name: "", address: m.reply_to } : from;
    rTo = role === "sent" ? to : [primary];
    if (mode === "reply_all") {
      const extra = [...(role === "sent" ? [] : to), ...cc].filter((a) => !own.has(a.address) && !rTo.some((x) => x.address === a.address));
      rCc = extra;
    }
    rTo = rTo.filter((a) => !own.has(a.address) || rTo.length === 1);
  }
  const base = m.subject.replace(/^\s*((re|fwd?|aw|wg)\s*:\s*)+/i, "").trim();
  const subject = mode === "forward" ? `Fwd: ${base}` : `Re: ${base}`;
  const when = new Date(m.date * 1000).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const who = from.name ? `${from.name} &lt;${escapeHtml(from.address)}&gt;` : escapeHtml(from.address);
  const quoted = m.body_html ?? textToHtml(m.body_text ?? m.snippet);
  const head = mode === "forward"
    ? `<p>---------- Forwarded message ---------<br>From: ${who}<br>Date: ${escapeHtml(when)}<br>Subject: ${escapeHtml(m.subject)}</p>`
    : `<p>On ${escapeHtml(when)}, ${who} wrote:</p>`;
  const sig = acc.signature ? `<div class="mm-sig">${textToHtml(acc.signature)}</div>` : "";
  const body = `<p></p>${sig}<br>${head}<blockquote>${quoted}</blockquote>`;
  const d = createDraft(userId, { accountId: acc.id, inReplyToMessageId: mode === "forward" ? null : m.id, to: rTo, cc: rCc, subject, bodyHtml: body });
  return d;
}

export type SendResult = { draftId: string; sendAt: number };

/** Queue a draft for sending after the undo window. The worker performs the SMTP delivery. */
export function sendDraft(userId: string, id: string, opts: { delaySeconds?: number; at?: number } = {}): SendResult {
  const d = ownedDraft(userId, id);
  const to = parseAddrs(d.to_json);
  if (!to.length && !parseAddrs(d.cc_json).length && !parseAddrs(d.bcc_json).length) throw new HttpError(400, "Add at least one recipient");
  const sendAt = opts.at ?? Math.floor(Date.now() / 1000) + Math.max(0, opts.delaySeconds ?? getSettings(userId).undoSendSeconds);
  db().prepare("UPDATE drafts SET status = 'scheduled', send_at = ?, error = NULL WHERE id = ?").run(sendAt, id);
  return { draftId: id, sendAt };
}

export function cancelSend(userId: string, id: string) {
  const d = ownedDraft(userId, id);
  if (d.status !== "scheduled") throw new HttpError(409, "Too late to undo — already sending");
  db().prepare("UPDATE drafts SET status = 'draft', send_at = NULL WHERE id = ? AND status = 'scheduled'").run(id);
}

/** Immediately deliver a draft via SMTP (used by the send worker and by sendNow). */
export async function deliverDraft(draftId: string): Promise<void> {
  const claimed = db().prepare("UPDATE drafts SET status = 'sending' WHERE id = ? AND status = 'scheduled'").run(draftId);
  if (!claimed.changes) return;
  const d = db().prepare("SELECT * FROM drafts WHERE id = ?").get(draftId) as DraftRow;
  try {
    const acc = userAccount(d.user_id, d.account_id);
    let inReplyTo: string | null = null;
    let references: string[] = [];
    let parent: MsgRow | undefined;
    if (d.in_reply_to_message_id) {
      parent = getMsg(d.in_reply_to_message_id);
      if (parent) {
        inReplyTo = parent.message_id;
        references = [...(parent.refs ? parent.refs.split(" ") : []), ...(parent.message_id ? [parent.message_id] : [])];
      }
    }
    const files = db().prepare("SELECT filename, content_type, path FROM draft_files WHERE draft_id = ?").all(draftId) as { filename: string; content_type: string; path: string }[];
    const html = d.body_html.includes("<html") ? d.body_html : `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5">${d.body_html}</div>`;
    const res = await deliver(acc, {
      from: { name: acc.name, address: acc.email },
      to: parseAddrs(d.to_json), cc: parseAddrs(d.cc_json), bcc: parseAddrs(d.bcc_json),
      subject: d.subject, html, text: d.body_text || htmlToText(d.body_html),
      inReplyTo, references,
      attachments: files.map((f) => ({ filename: f.filename, contentType: f.content_type, path: f.path })),
    });
    // keep a copy in Sent (SES etc. do not do this for us)
    const sent = ensureFolder(acc.id, "sent");
    const { queueOp } = await import("./ops");
    queueOp(acc.id, { kind: "append", folderId: sent.id, raw: res.raw.toString("base64"), flags: ["\\Seen"] });
    if (parent) setFlags(parent.id, { answered: true });
    // remember recipients
    const up = db().prepare("INSERT INTO contacts (user_id, email, name, count, last_seen) VALUES (?,?,?,3,unixepoch()) ON CONFLICT(user_id, email) DO UPDATE SET count = count + 3, last_seen = unixepoch()");
    for (const a of [...parseAddrs(d.to_json), ...parseAddrs(d.cc_json), ...parseAddrs(d.bcc_json)]) up.run(d.user_id, a.address, a.name);
    db().prepare("UPDATE drafts SET status = 'sent', error = NULL WHERE id = ?").run(draftId);
    for (const f of files) fs.rm(f.path, { force: true }, () => {});
    db().prepare("DELETE FROM draft_files WHERE draft_id = ?").run(draftId);
    db().prepare("INSERT INTO audit_log (user_id, actor, action, detail) VALUES (?,?,?,?)").run(d.user_id, "system", "sent", `${d.subject} → ${parseAddrs(d.to_json).map((a) => a.address).join(",")}`);
    publish(d.user_id, { type: "sent", draftId, ok: true });
    publish(d.user_id, { type: "mail", accountId: acc.id, reason: "sent" });
  } catch (e) {
    db().prepare("UPDATE drafts SET status = 'failed', error = ? WHERE id = ?").run((e as Error).message, draftId);
    publish(d.user_id, { type: "sent", draftId, ok: false, error: (e as Error).message });
  }
}

/** Send now, awaiting SMTP completion (used by MCP / API clients that want a definite result). */
export async function sendDraftNow(userId: string, id: string) {
  sendDraft(userId, id, { delaySeconds: 0 });
  await deliverDraft(id);
  const d = ownedDraft(userId, id);
  if (d.status !== "sent") throw new HttpError(502, d.error || "Send failed");
  return { ok: true };
}

export async function composeAndSend(userId: string, raw: unknown) {
  const i = draftInput.extend({ body: z.string().optional() }).parse(raw);
  const html = i.bodyHtml || (i.body ? textToHtml(i.body) : "");
  const draft = createDraft(userId, { ...i, bodyHtml: html || undefined, bodyText: i.bodyText ?? i.body });
  if (!html) updateDraft(userId, draft.id, { bodyHtml: "" });
  await sendDraftNow(userId, draft.id);
  return { ok: true, draftId: draft.id };
}

export function saveUpload(userId: string, file: { name: string; type: string; data: Buffer }, draftId?: string) {
  if (file.data.length > 25 * 1024 * 1024) throw new HttpError(413, "Attachment too large (max 25MB)");
  if (draftId) ownedDraft(userId, draftId);
  const id = uid();
  const dir = path.join(DATA_DIR, "uploads");
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, id);
  fs.writeFileSync(p, file.data, { mode: 0o600 });
  const filename = path.basename(file.name).replace(/[\r\n"]/g, "_").slice(0, 200) || "file";
  db().prepare("INSERT INTO draft_files (id, user_id, draft_id, filename, content_type, size, path) VALUES (?,?,?,?,?,?,?)").run(id, userId, draftId ?? null, filename, file.type || "application/octet-stream", file.data.length, p);
  return { id, filename, size: file.data.length, contentType: file.type };
}
export function draftFiles(userId: string, draftId: string) {
  ownedDraft(userId, draftId);
  return db().prepare("SELECT id, filename, content_type contentType, size FROM draft_files WHERE draft_id = ?").all(draftId) as { id: string; filename: string; contentType: string; size: number }[];
}
export function removeUpload(userId: string, id: string) {
  const f = db().prepare("SELECT path FROM draft_files WHERE id = ? AND user_id = ?").get(id, userId) as { path: string } | undefined;
  if (!f) return;
  fs.rm(f.path, { force: true }, () => {});
  db().prepare("DELETE FROM draft_files WHERE id = ?").run(id);
}

/* ---------------------------------- attachments ---------------------------------- */

export async function getAttachmentContent(userId: string, attId: string): Promise<{ filename: string; contentType: string; content: Buffer }> {
  const row = db()
    .prepare(
      `SELECT at.idx, at.filename, at.content_type, m.uid, m.account_id, f.path FROM attachments at JOIN messages m ON m.id = at.message_id JOIN folders f ON f.id = m.folder_id JOIN mail_accounts a ON a.id = m.account_id WHERE at.id = ? AND a.user_id = ?`,
    )
    .get(attId, userId) as { idx: number; filename: string; content_type: string; uid: number; account_id: string; path: string } | undefined;
  if (!row) throw new HttpError(404, "Attachment not found");
  if (row.uid < 0) throw new HttpError(409, "Message is still syncing; try again in a moment");
  const acc = userAccount(userId, row.account_id);
  const client = makeClient(acc);
  try {
    await client.connect();
    const lock = await client.getMailboxLock(row.path, { readOnly: true });
    try {
      const dl = await client.download(String(row.uid), undefined, { uid: true });
      const chunks: Buffer[] = [];
      for await (const c of dl.content!) chunks.push(Buffer.from(c));
      const parsed = await simpleParser(Buffer.concat(chunks));
      const a = parsed.attachments[row.idx];
      if (!a) throw new HttpError(404, "Attachment not found in message");
      return { filename: row.filename, contentType: row.content_type, content: a.content };
    } finally {
      lock.release();
    }
  } finally {
    try { await client.logout(); } catch {}
  }
}

/* ---------------------------------- unsubscribe ---------------------------------- */

export function unsubscribeInfo(userId: string, messageId: string): { mailto: string | null; url: string | null } {
  const m = ownedMessage(userId, messageId);
  const h = m.list_unsubscribe || "";
  const mailto = h.match(/<(mailto:[^>]+)>/i)?.[1] ?? null;
  const url = h.match(/<(https?:[^>]+)>/i)?.[1] ?? null;
  return { mailto, url };
}

export async function unsubscribe(userId: string, messageId: string) {
  const info = unsubscribeInfo(userId, messageId);
  const m = ownedMessage(userId, messageId);
  if (info.mailto) {
    const u = new URL(info.mailto);
    const to = decodeURIComponent(u.pathname);
    const d = createDraft(userId, { accountId: m.account_id, to: [{ name: "", address: to }], subject: u.searchParams.get("subject") || "unsubscribe", bodyHtml: "<p>unsubscribe</p>" });
    await sendDraftNow(userId, d.id);
    return { method: "mailto" as const };
  }
  if (info.url) return { method: "url" as const, url: info.url };
  throw new HttpError(404, "No unsubscribe option found");
}

/* ---------------------------------- misc ---------------------------------- */

export function snoozeTick() {
  const rows = db().prepare("SELECT m.id, a.user_id, m.account_id FROM messages m JOIN mail_accounts a ON a.id = m.account_id WHERE m.snoozed_until IS NOT NULL AND m.snoozed_until <= unixepoch()").all() as { id: string; user_id: string; account_id: string }[];
  if (!rows.length) return;
  const touched = new Set<string>();
  for (const r of rows) {
    db().prepare("UPDATE messages SET snoozed_until = NULL, seen = 0 WHERE id = ?").run(r.id);
    setFlags(r.id, { seen: false });
    touched.add(`${r.user_id}|${r.account_id}`);
  }
  for (const t of touched) { const [u, a] = t.split("|"); publish(u, { type: "mail", accountId: a, reason: "unsnooze" }); }
}

export { syncAccountOnce, accountPasswords };

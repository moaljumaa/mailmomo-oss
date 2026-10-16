import { db, tx } from "../db";
import { uid } from "../crypto";
import { parseRaw, makeSnippet } from "./parse";
import { resolveThreadId } from "./threading";
import { heuristicCategory } from "./heuristics";
import { applyRules } from "./rules";
import { getMsg } from "./ops";
import { publish } from "../bus";
import type { MsgRow } from "./rows";

export type IngestInput = {
  account: { id: string; user_id: string; email: string };
  folder: { id: string; special_use: string | null };
  uid: number;
  flags: Set<string>;
  source: Buffer | string;
  size?: number;
  internalDate?: Date;
  /** true for real new arrivals (rules + notifications), false for historical backfill */
  isNew?: boolean;
};

export type IngestResult = { id: string; inserted: boolean; row: MsgRow } | null;

function harvestContacts(userId: string, role: string | null, from: { name: string; address: string }, to: { name: string; address: string }[], cc: { name: string; address: string }[], date: number, ownEmail: string) {
  const up = db().prepare(
    `INSERT INTO contacts (user_id, email, name, count, last_seen) VALUES (?,?,?,?,?)
     ON CONFLICT(user_id, email) DO UPDATE SET count = count + excluded.count, last_seen = max(last_seen, excluded.last_seen), name = CASE WHEN contacts.name = '' THEN excluded.name ELSE contacts.name END`,
  );
  const own = ownEmail.toLowerCase();
  if (role === "sent") {
    for (const a of [...to, ...cc]) if (a.address && a.address !== own) up.run(userId, a.address, a.name, 3, date);
  } else if (from.address && from.address !== own) {
    up.run(userId, from.address, from.name, 1, date);
  }
}

export async function ingestRaw(i: IngestInput): Promise<IngestResult> {
  const d = db();
  const existing = d.prepare("SELECT id FROM messages WHERE folder_id = ? AND uid = ?").get(i.folder.id, i.uid) as { id: string } | undefined;
  if (existing) return null;

  const id = uid();
  const p = await parseRaw(i.source, (_cid, idx) => `/api/attachments/${id}_${idx}`);

  // Adopt an optimistic row left by a local move whose UID we have not learned yet.
  if (p.messageId) {
    const adopt = d
      .prepare("SELECT id FROM messages WHERE folder_id = ? AND message_id = ? AND uid < 0 LIMIT 1")
      .get(i.folder.id, p.messageId) as { id: string } | undefined;
    if (adopt) {
      d.prepare("UPDATE messages SET uid = ? WHERE id = ?").run(i.uid, adopt.id);
      return { id: adopt.id, inserted: false, row: getMsg(adopt.id)! };
    }
  }

  const role = i.folder.special_use;
  const threadId = resolveThreadId({
    accountId: i.account.id,
    messageId: p.messageId,
    inReplyTo: p.inReplyTo,
    references: p.references,
    subject: p.subject,
    date: p.date,
  });
  const incoming = role !== "sent" && role !== "drafts";
  const category = incoming
    ? heuristicCategory({
        fromAddr: p.from.address,
        subject: p.subject,
        listUnsubscribe: p.listUnsubscribe,
        hasListId: p.hasListId,
        precedenceBulk: p.precedenceBulk,
        autoSubmitted: p.autoSubmitted,
      })
    : null;
  const flags = i.flags;
  const hasReal = p.attachments.some((a) => !a.inline);

  tx(() => {
    d.prepare(
      `INSERT INTO messages (id, account_id, folder_id, uid, message_id, in_reply_to, refs, thread_id, subject, from_name, from_addr, to_json, cc_json, reply_to,
        date, snippet, body_text, body_html, has_attachments, size, seen, flagged, answered, draft, list_unsubscribe, category, ai_state)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, i.account.id, i.folder.id, i.uid, p.messageId, p.inReplyTo, p.references.join(" ") || null, threadId, p.subject,
      p.from.name, p.from.address, JSON.stringify(p.to), JSON.stringify(p.cc), p.replyTo,
      p.date, p.snippet || makeSnippet(p.subject), p.text.slice(0, 200_000), p.html ? p.html.slice(0, 1_000_000) : null,
      hasReal ? 1 : 0, i.size ?? 0,
      flags.has("\\Seen") ? 1 : 0, flags.has("\\Flagged") ? 1 : 0, flags.has("\\Answered") ? 1 : 0, flags.has("\\Draft") ? 1 : 0,
      p.listUnsubscribe, category, incoming ? "pending" : "skipped",
    );
    const insAtt = d.prepare("INSERT INTO attachments (id, message_id, idx, filename, content_type, size, cid, inline) VALUES (?,?,?,?,?,?,?,?)");
    p.attachments.forEach((a, idx) => insAtt.run(`${id}_${idx}`, id, idx, a.filename, a.contentType, a.size, a.cid, a.inline ? 1 : 0));
    harvestContacts(i.account.user_id, role, p.from, p.to, p.cc, p.date, i.account.email);
  });

  const row = getMsg(id)!;
  if (i.isNew && role === "inbox") {
    applyRules(i.account.user_id, row, i.account.email, !!(p.listUnsubscribe || p.hasListId));
  }
  publish(i.account.user_id, { type: "mail", accountId: i.account.id, reason: "ingest" });
  return { id, inserted: true, row };
}

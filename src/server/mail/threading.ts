import { db } from "../db";
import { uid } from "../crypto";

export function normalizeSubject(s: string): string {
  let prev = "";
  let cur = s.trim();
  while (prev !== cur) {
    prev = cur;
    cur = cur.replace(/^\s*((re|fwd?|aw|wg|sv|antw|tr|r)\s*(\[\d+\])?\s*:\s*)+/i, "").trim();
  }
  return cur.toLowerCase();
}

/**
 * Find (or create) a thread id for a message using the Message-ID / In-Reply-To /
 * References graph, falling back to normalized subject for replies.
 */
export function resolveThreadId(opts: {
  accountId: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  subject: string;
  date: number;
}): string {
  const d = db();
  const ids = [...new Set([...opts.references, ...(opts.inReplyTo ? [opts.inReplyTo] : [])])];
  if (ids.length) {
    const q = `SELECT thread_id FROM messages WHERE account_id = ? AND message_id IN (${ids.map(() => "?").join(",")}) LIMIT 1`;
    const r = d.prepare(q).get(opts.accountId, ...ids) as { thread_id: string } | undefined;
    if (r) return r.thread_id;
  }
  if (opts.messageId) {
    // a child that arrived before its parent
    const r = d
      .prepare(
        `SELECT thread_id FROM messages WHERE account_id = ? AND (in_reply_to = ? OR (refs IS NOT NULL AND (refs = ? OR refs LIKE ? OR refs LIKE ? OR refs LIKE ?))) LIMIT 1`,
      )
      .get(opts.accountId, opts.messageId, opts.messageId, `${opts.messageId} %`, `% ${opts.messageId}`, `% ${opts.messageId} %`) as
      | { thread_id: string }
      | undefined;
    if (r) return r.thread_id;
  }
  const isReply = /^\s*((re|fwd?|aw|wg|sv|antw|tr)\s*(\[\d+\])?\s*:)/i.test(opts.subject);
  if (isReply) {
    const norm = normalizeSubject(opts.subject);
    if (norm) {
      const r = d
        .prepare(
          `SELECT thread_id, subject FROM messages WHERE account_id = ? AND date > ? AND date < ? AND lower(subject) LIKE ? ORDER BY date DESC LIMIT 20`,
        )
        .all(opts.accountId, opts.date - 60 * 86400, opts.date + 86400, `%${norm.replace(/[%_]/g, "")}%`) as { thread_id: string; subject: string }[];
      const hit = r.find((x) => normalizeSubject(x.subject) === norm);
      if (hit) return hit.thread_id;
    }
  }
  return uid();
}

import { db } from "../db";
import type { Addr, AttachmentDTO, Category, FolderRole, LabelDTO, MessageDTO, ThreadSummary } from "@/lib/types";

export type MsgRow = {
  id: string; account_id: string; folder_id: string; uid: number; message_id: string | null; in_reply_to: string | null; refs: string | null;
  thread_id: string; subject: string; from_name: string; from_addr: string; to_json: string; cc_json: string; reply_to: string | null;
  date: number; snippet: string; body_text: string | null; body_html: string | null; has_attachments: number; size: number;
  seen: number; flagged: number; answered: number; draft: number; list_unsubscribe: string | null;
  category: string | null; priority: number | null; summary: string | null; needs_reply: number; ai_state: string; snoozed_until: number | null;
};

export function parseAddrs(j: string): Addr[] {
  try {
    return JSON.parse(j) as Addr[];
  } catch {
    return [];
  }
}

export function labelsFor(messageIds: string[]): Map<string, LabelDTO[]> {
  const out = new Map<string, LabelDTO[]>();
  if (!messageIds.length) return out;
  const rows = db()
    .prepare(
      `SELECT ml.message_id mid, l.id, l.name, l.color, ml.source FROM message_labels ml JOIN labels l ON l.id = ml.label_id WHERE ml.message_id IN (${messageIds.map(() => "?").join(",")})`,
    )
    .all(...messageIds) as { mid: string; id: string; name: string; color: string; source: string }[];
  for (const r of rows) {
    const a = out.get(r.mid) ?? [];
    a.push({ id: r.id, name: r.name, color: r.color, source: r.source });
    out.set(r.mid, a);
  }
  return out;
}

export function folderRole(folderId: string): FolderRole {
  const r = db().prepare("SELECT special_use FROM folders WHERE id = ?").get(folderId) as { special_use: string | null } | undefined;
  return (r?.special_use as FolderRole) ?? null;
}

export function toMessageDTO(r: MsgRow, labels: LabelDTO[], role: FolderRole): MessageDTO {
  const atts = db()
    .prepare("SELECT id, filename, content_type, size, inline FROM attachments WHERE message_id = ? ORDER BY idx")
    .all(r.id) as { id: string; filename: string; content_type: string; size: number; inline: number }[];
  const attachments: AttachmentDTO[] = atts.map((a) => ({ id: a.id, filename: a.filename, contentType: a.content_type, size: a.size, inline: !!a.inline }));
  return {
    id: r.id,
    accountId: r.account_id,
    folderId: r.folder_id,
    threadId: r.thread_id,
    messageId: r.message_id,
    subject: r.subject,
    from: { name: r.from_name, address: r.from_addr },
    to: parseAddrs(r.to_json),
    cc: parseAddrs(r.cc_json),
    replyTo: r.reply_to,
    date: r.date,
    seen: !!r.seen,
    flagged: !!r.flagged,
    answered: !!r.answered,
    bodyHtml: r.body_html,
    bodyText: r.body_text ?? r.snippet,
    hasRemoteImages: !!r.body_html && /<img[^>]+src="https?:/i.test(r.body_html),
    attachments,
    category: (r.category as Category) ?? null,
    priority: r.priority,
    summary: r.summary,
    needsReply: !!r.needs_reply,
    labels,
    listUnsubscribe: r.list_unsubscribe,
    folderRole: role,
  };
}

export function toThreadSummary(
  r: MsgRow & { cnt: number; unread_cnt: number; ans_cnt: number; people: string | null },
  labels: LabelDTO[],
): ThreadSummary {
  return {
    id: r.id,
    threadId: r.thread_id,
    accountId: r.account_id,
    folderId: r.folder_id,
    subject: r.subject,
    fromName: r.from_name,
    fromAddr: r.from_addr,
    participants: (r.people || "").split("\u0001").filter(Boolean).slice(0, 4),
    snippet: r.snippet,
    date: r.date,
    seen: !!r.seen && r.unread_cnt === 0,
    flagged: !!r.flagged,
    answered: !!r.answered || r.ans_cnt > 0,
    hasAttachments: !!r.has_attachments,
    category: (r.category as Category) ?? null,
    priority: r.priority,
    summary: r.summary,
    needsReply: !!r.needs_reply,
    snoozedUntil: r.snoozed_until,
    labels,
    count: r.cnt,
    unreadCount: r.unread_cnt,
  };
}

import { db, tx } from "../db";
import { uid } from "../crypto";
import { wake } from "./wake";
import type { MsgRow } from "./rows";
import type { FolderRole } from "@/lib/types";

/**
 * Optimistic local mutations + durable queue of IMAP operations.
 * Local state changes immediately; the sync loop replays ops against the server.
 */

export type Op =
  | { kind: "flags"; mid: string; add: string[]; remove: string[] }
  | { kind: "move"; mid: string; srcFolderId: string; srcUid: number; destFolderId: string }
  | { kind: "delete"; folderId: string; uid: number }
  | { kind: "append"; folderId: string; raw: string; flags: string[] }
  | { kind: "mkfolder"; folderId: string };

export function queueOp(accountId: string, op: Op) {
  const { kind, ...payload } = op;
  db().prepare("INSERT INTO pending_ops (id, account_id, kind, payload) VALUES (?,?,?,?)").run(uid(), accountId, kind, JSON.stringify(payload));
  wake(accountId);
}

export function getMsg(id: string): MsgRow | undefined {
  return db().prepare("SELECT * FROM messages WHERE id = ?").get(id) as MsgRow | undefined;
}

export function findFolder(accountId: string, role: FolderRole): { id: string; path: string } | undefined {
  return db().prepare("SELECT id, path FROM folders WHERE account_id = ? AND special_use = ? LIMIT 1").get(accountId, role) as
    | { id: string; path: string }
    | undefined;
}

/** Return the folder for a role, creating a conventional one locally (+ queued MKDIR) if the server has none. */
export function ensureFolder(accountId: string, role: Exclude<FolderRole, null>): { id: string; path: string } {
  const f = findFolder(accountId, role);
  if (f) return f;
  const names: Record<string, string> = { archive: "Archive", trash: "Trash", sent: "Sent", drafts: "Drafts", junk: "Junk", inbox: "INBOX", all: "All Mail" };
  const name = names[role] ?? role;
  const existing = db().prepare("SELECT id, path FROM folders WHERE account_id = ? AND lower(path) = lower(?)").get(accountId, name) as
    | { id: string; path: string }
    | undefined;
  if (existing) {
    db().prepare("UPDATE folders SET special_use = ? WHERE id = ?").run(role, existing.id);
    return existing;
  }
  const id = uid();
  db().prepare("INSERT INTO folders (id, account_id, path, name, special_use) VALUES (?,?,?,?,?)").run(id, accountId, name, name, role);
  queueOp(accountId, { kind: "mkfolder", folderId: id });
  return { id, path: name };
}

export function setFlags(mid: string, change: { seen?: boolean; flagged?: boolean; answered?: boolean }) {
  const m = getMsg(mid);
  if (!m) return;
  const sets: string[] = [];
  const vals: number[] = [];
  const add: string[] = [];
  const remove: string[] = [];
  const map: [keyof typeof change, string, string, number][] = [
    ["seen", "seen", "\\Seen", m.seen],
    ["flagged", "flagged", "\\Flagged", m.flagged],
    ["answered", "answered", "\\Answered", m.answered],
  ];
  for (const [k, col, flag, cur] of map) {
    const v = change[k];
    if (v === undefined || (v ? 1 : 0) === cur) continue;
    sets.push(`${col} = ?`);
    vals.push(v ? 1 : 0);
    (v ? add : remove).push(flag);
  }
  if (!sets.length) return;
  tx(() => {
    db().prepare(`UPDATE messages SET ${sets.join(",")} WHERE id = ?`).run(...vals, mid);
    if (m.uid > 0) queueOp(m.account_id, { kind: "flags", mid, add, remove });
  });
}

export function moveMessage(mid: string, destFolderId: string) {
  const m = getMsg(mid);
  if (!m || m.folder_id === destFolderId) return;
  tx(() => {
    const tempUid = -Math.floor(Math.random() * 2_000_000_000) - 1;
    db().prepare("UPDATE messages SET folder_id = ?, uid = ? WHERE id = ?").run(destFolderId, tempUid, mid);
    if (m.uid > 0) queueOp(m.account_id, { kind: "move", mid, srcFolderId: m.folder_id, srcUid: m.uid, destFolderId });
  });
}

export function deleteForever(mid: string) {
  const m = getMsg(mid);
  if (!m) return;
  tx(() => {
    db().prepare("DELETE FROM messages WHERE id = ?").run(mid);
    if (m.uid > 0) queueOp(m.account_id, { kind: "delete", folderId: m.folder_id, uid: m.uid });
  });
}

export function trashMessage(mid: string) {
  const m = getMsg(mid);
  if (!m) return;
  const cur = db().prepare("SELECT special_use FROM folders WHERE id = ?").get(m.folder_id) as { special_use: string | null };
  if (cur.special_use === "trash") return deleteForever(mid);
  const trash = ensureFolder(m.account_id, "trash");
  moveMessage(mid, trash.id);
}

export function archiveMessage(mid: string) {
  const m = getMsg(mid);
  if (!m) return;
  const arch = ensureFolder(m.account_id, "archive");
  moveMessage(mid, arch.id);
}

export function pendingMids(accountId: string): Set<string> {
  const rows = db().prepare("SELECT payload FROM pending_ops WHERE account_id = ? AND kind IN ('flags','move')").all(accountId) as { payload: string }[];
  const s = new Set<string>();
  for (const r of rows) {
    try {
      const p = JSON.parse(r.payload);
      if (p.mid) s.add(p.mid);
    } catch {}
  }
  return s;
}

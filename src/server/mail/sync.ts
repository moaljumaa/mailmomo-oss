import { ImapFlow, type ListResponse, type FetchMessageObject } from "imapflow";
import { db } from "../db";
import { uid as newId } from "../crypto";
import { env } from "../env";
import { publish } from "../bus";
import { getAccount, accountPasswords, type AccountRow } from "./accounts";
import { ingestRaw } from "./ingest";
import { getMsg, pendingMids } from "./ops";
import { wakers } from "./wake";
import type { FolderRole } from "@/lib/types";

const FETCH_CHUNK = 20;
const MAX_SOURCE = 4_000_000;
const BACKFILL_BATCH = 100;
const POLL_MS = 90_000;
const BACKFILL_BUDGET_MS = 15_000;

type FolderRow = {
  id: string; account_id: string; path: string; name: string; special_use: string | null; uidvalidity: string | null;
  uidnext: number; highestmodseq: string | null; last_uid: number; backfill_before_uid: number | null; sync_enabled: number;
};

export function makeClient(acc: AccountRow): ImapFlow {
  const pw = accountPasswords(acc);
  const c = new ImapFlow({
    host: acc.imap_host,
    port: acc.imap_port,
    secure: !!acc.imap_secure,
    auth: { user: acc.imap_user, pass: pw.imap },
    logger: false,
    tls: { rejectUnauthorized: !!acc.tls_reject_unauthorized },
    disableAutoIdle: false,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
  });
  c.on("error", () => {});
  return c;
}

const NAME_ROLES: [RegExp, FolderRole][] = [
  [/^(inbox)$/i, "inbox"],
  [/(^|[./])(sent|sent items|sent mail|gesendet|gesendete elemente)$/i, "sent"],
  [/(^|[./])(drafts?|entw(ü|u)rfe)$/i, "drafts"],
  [/(^|[./])(trash|deleted|deleted items|deleted messages|bin|papierkorb|gel(ö|o)scht)$/i, "trash"],
  [/(^|[./])(junk|spam|junk e-?mail)$/i, "junk"],
  [/(^|[./])(archive|archives|archiv)$/i, "archive"],
];

export function detectRole(l: { path: string; name: string; specialUse?: string }): FolderRole {
  if (l.path.toUpperCase() === "INBOX") return "inbox";
  const su = (l.specialUse || "").toLowerCase();
  const map: Record<string, FolderRole> = { "\\sent": "sent", "\\drafts": "drafts", "\\trash": "trash", "\\junk": "junk", "\\archive": "archive", "\\all": "all" };
  if (map[su]) return map[su];
  for (const [re, role] of NAME_ROLES) if (re.test(l.path) || re.test(l.name)) return role;
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setState(acc: AccountRow, state: "idle" | "syncing" | "error", error: string | null = null) {
  db().prepare("UPDATE mail_accounts SET sync_state = ?, sync_error = ?, last_synced_at = CASE WHEN ? = 'idle' THEN unixepoch() ELSE last_synced_at END WHERE id = ?").run(state, error, state, acc.id);
  publish(acc.user_id, { type: "sync", accountId: acc.id, state, error });
}

export async function syncFolderList(client: ImapFlow, acc: AccountRow) {
  const list: ListResponse[] = await client.list();
  const d = db();
  const seen = new Set<string>();
  const roleTaken = new Set<string>();
  const ins = d.prepare("INSERT INTO folders (id, account_id, path, name, special_use, sync_enabled) VALUES (?,?,?,?,?,?) ON CONFLICT(account_id, path) DO UPDATE SET name = excluded.name, special_use = COALESCE(excluded.special_use, folders.special_use)");
  for (const l of list) {
    if (l.flags?.has("\\Noselect") || l.flags?.has("\\NonExistent")) continue;
    const role = detectRole(l);
    if (role && role !== "inbox" && roleTaken.has(role)) continue;
    if (role) roleTaken.add(role);
    seen.add(l.path);
    ins.run(newId(), acc.id, l.path, l.name, role, role === "all" ? 0 : 1);
  }
  // folders removed on the server: drop them (messages cascade) unless local-only pending creation
  const pendingMk = new Set(
    (d.prepare("SELECT payload FROM pending_ops WHERE account_id = ? AND kind = 'mkfolder'").all(acc.id) as { payload: string }[]).map((r) => JSON.parse(r.payload).folderId),
  );
  const rows = d.prepare("SELECT id, path FROM folders WHERE account_id = ?").all(acc.id) as { id: string; path: string }[];
  for (const r of rows) if (!seen.has(r.path) && !pendingMk.has(r.id)) d.prepare("DELETE FROM folders WHERE id = ?").run(r.id);
}

function flagSet(m: FetchMessageObject): Set<string> {
  return new Set(m.flags ?? []);
}

async function fetchAndIngest(client: ImapFlow, acc: AccountRow, folder: FolderRow, uids: number[], isNew: boolean): Promise<number> {
  let n = 0;
  for (let i = 0; i < uids.length; i += FETCH_CHUNK) {
    const chunk = uids.slice(i, i + FETCH_CHUNK);
    const msgs: FetchMessageObject[] = [];
    for await (const m of client.fetch(chunk.join(","), { uid: true, flags: true, size: true, internalDate: true, source: { maxLength: MAX_SOURCE } } as never, { uid: true })) {
      msgs.push(m);
    }
    for (const m of msgs) {
      if (!m.source) continue;
      try {
        const r = await ingestRaw({
          account: { id: acc.id, user_id: acc.user_id, email: acc.email },
          folder: { id: folder.id, special_use: folder.special_use },
          uid: m.uid,
          flags: flagSet(m),
          source: m.source,
          size: m.size,
          internalDate: m.internalDate instanceof Date ? m.internalDate : undefined,
          isNew,
        });
        if (r?.inserted) n++;
      } catch (e) {
        console.error(`[sync ${acc.email}] ingest failed uid=${m.uid}:`, (e as Error).message);
      }
    }
  }
  return n;
}

async function syncFolder(client: ImapFlow, acc: AccountRow, folderId: string, opts: { deadline?: number; onOpsDirty?: () => boolean } = {}): Promise<void> {
  const d = db();
  const first = d.prepare("SELECT * FROM folders WHERE id = ?").get(folderId) as FolderRow | undefined;
  if (!first || !first.sync_enabled) return;
  let folder: FolderRow = first;
  const lock = await client.getMailboxLock(folder.path);
  try {
    const mb = client.mailbox;
    if (!mb || typeof mb === "boolean") return;
    const uv = String(mb.uidValidity);
    if (folder.uidvalidity && folder.uidvalidity !== uv) {
      d.prepare("DELETE FROM messages WHERE folder_id = ? AND uid > 0").run(folder.id);
      d.prepare("UPDATE folders SET last_uid = 0, backfill_before_uid = NULL, highestmodseq = NULL WHERE id = ?").run(folder.id);
      folder = d.prepare("SELECT * FROM folders WHERE id = ?").get(folderId) as FolderRow;
    }
    d.prepare("UPDATE folders SET uidvalidity = ? WHERE id = ?").run(uv, folder.id);

    const isInbox = folder.special_use === "inbox";
    // 1. new messages
    let newUids: number[] = [];
    const initial = folder.last_uid === 0 && folder.backfill_before_uid === null;
    if (initial) {
      const since = new Date(Date.now() - env.initialSyncDays * 86400_000);
      newUids = ((await client.search({ since }, { uid: true })) || []) as number[];
    } else {
      const found = ((await client.search({ uid: `${folder.last_uid + 1}:*` }, { uid: true })) || []) as number[];
      newUids = found.filter((u) => u > folder.last_uid);
    }
    newUids.sort((a, b) => b - a);
    if (newUids.length) await fetchAndIngest(client, acc, folder, newUids, !initial && isInbox);
    const topUid = Math.max(folder.last_uid, ...(newUids.length ? [newUids[0]] : [0]), mb.uidNext ? mb.uidNext - 1 : 0);
    d.prepare("UPDATE folders SET last_uid = ?, uidnext = ? WHERE id = ?").run(topUid, mb.uidNext ?? 1, folder.id);
    if (initial) {
      const minUid = newUids.length ? newUids[newUids.length - 1] : (mb.uidNext ?? 1);
      d.prepare("UPDATE folders SET backfill_before_uid = ? WHERE id = ?").run(minUid <= 1 ? 0 : minUid, folder.id);
    }

    // 2. flag reconciliation (CONDSTORE when available)
    const hms = (mb as { highestModseq?: bigint }).highestModseq;
    const localCount = (d.prepare("SELECT COUNT(*) c FROM messages WHERE folder_id = ? AND uid > 0").get(folder.id) as { c: number }).c;
    if (localCount > 0) {
      const skip = pendingMids(acc.id);
      const flagFetch: Record<string, unknown> = {};
      const range = "1:*";
      if (hms !== undefined && folder.highestmodseq) flagFetch.changedSince = BigInt(folder.highestmodseq);
      const changes: { uid: number; flags: Set<string> }[] = [];
      if (localCount <= 50_000) {
        for await (const m of client.fetch(range, { uid: true, flags: true }, { uid: true, ...flagFetch } as never)) {
          changes.push({ uid: m.uid, flags: flagSet(m) });
        }
      }
      const upd = d.prepare("UPDATE messages SET seen = ?, flagged = ?, answered = ?, draft = ? WHERE folder_id = ? AND uid = ? AND (seen != ? OR flagged != ? OR answered != ? OR draft != ?)");
      const idOf = d.prepare("SELECT id FROM messages WHERE folder_id = ? AND uid = ?");
      for (const c of changes) {
        const row = idOf.get(folder.id, c.uid) as { id: string } | undefined;
        if (!row || skip.has(row.id)) continue;
        const s = c.flags.has("\\Seen") ? 1 : 0, f = c.flags.has("\\Flagged") ? 1 : 0, a = c.flags.has("\\Answered") ? 1 : 0, dr = c.flags.has("\\Draft") ? 1 : 0;
        upd.run(s, f, a, dr, folder.id, c.uid, s, f, a, dr);
      }
    }
    if (hms !== undefined) d.prepare("UPDATE folders SET highestmodseq = ? WHERE id = ?").run(String(hms), folder.id);

    // 3. expunge detection
    const after = (d.prepare("SELECT COUNT(*) c FROM messages WHERE folder_id = ? AND uid > 0").get(folder.id) as { c: number }).c;
    if (after > mb.exists) {
      const all = new Set(((await client.search({ all: true }, { uid: true })) || []) as number[]);
      const rows = d.prepare("SELECT id, uid FROM messages WHERE folder_id = ? AND uid > 0").all(folder.id) as { id: string; uid: number }[];
      const del = d.prepare("DELETE FROM messages WHERE id = ?");
      for (const r of rows) if (!all.has(r.uid)) del.run(r.id);
    }

    // 4. historical backfill (bounded per cycle so the loop stays responsive)
    folder = d.prepare("SELECT * FROM folders WHERE id = ?").get(folderId) as FolderRow;
    while (folder.backfill_before_uid && folder.backfill_before_uid > 1 && (!opts.deadline || Date.now() < opts.deadline) && !opts.onOpsDirty?.()) {
      const older = (((await client.search({ uid: `1:${folder.backfill_before_uid - 1}` }, { uid: true })) || []) as number[]).sort((a, b) => b - a).slice(0, BACKFILL_BATCH);
      if (!older.length) {
        d.prepare("UPDATE folders SET backfill_before_uid = 0 WHERE id = ?").run(folder.id);
        break;
      }
      await fetchAndIngest(client, acc, folder, older, false);
      const min = older[older.length - 1];
      d.prepare("UPDATE folders SET backfill_before_uid = ? WHERE id = ?").run(min <= 1 ? 0 : min, folder.id);
      folder = d.prepare("SELECT * FROM folders WHERE id = ?").get(folderId) as FolderRow;
    }
    publish(acc.user_id, { type: "mail", accountId: acc.id, reason: "folder-synced" });
  } finally {
    lock.release();
  }
}

type OpRow = { id: string; kind: string; payload: string; attempts: number };

export async function drainOps(client: ImapFlow, acc: AccountRow): Promise<number> {
  const d = db();
  const ops = d.prepare("SELECT id, kind, payload, attempts FROM pending_ops WHERE account_id = ? ORDER BY created_at, rowid").all(acc.id) as OpRow[];
  const folderPath = (id: string) => (d.prepare("SELECT path FROM folders WHERE id = ?").get(id) as { path: string } | undefined)?.path;
  let done = 0;
  for (const op of ops) {
    const p = JSON.parse(op.payload);
    try {
      switch (op.kind) {
        case "flags": {
          const m = getMsg(p.mid);
          if (!m) break;
          if (m.uid < 0) continue; // its move has not completed yet; retry next cycle
          const path = folderPath(m.folder_id);
          if (!path) break;
          const lock = await client.getMailboxLock(path);
          try {
            if (p.add?.length) await client.messageFlagsAdd({ uid: String(m.uid) }, p.add, { uid: true });
            if (p.remove?.length) await client.messageFlagsRemove({ uid: String(m.uid) }, p.remove, { uid: true });
          } finally {
            lock.release();
          }
          break;
        }
        case "move": {
          const src = folderPath(p.srcFolderId);
          const dest = folderPath(p.destFolderId);
          if (!src || !dest) break;
          const lock = await client.getMailboxLock(src);
          try {
            const r = await client.messageMove(String(p.srcUid), dest, { uid: true });
            const newUid = r && typeof r === "object" ? r.uidMap?.get(p.srcUid) : undefined;
            if (newUid) {
              const taken = d.prepare("SELECT id FROM messages WHERE folder_id = ? AND uid = ?").get(p.destFolderId, newUid);
              if (!taken) d.prepare("UPDATE messages SET uid = ? WHERE id = ? AND uid < 0").run(newUid, p.mid);
            }
          } finally {
            lock.release();
          }
          break;
        }
        case "delete": {
          const path = folderPath(p.folderId);
          if (!path) break;
          const lock = await client.getMailboxLock(path);
          try {
            await client.messageDelete({ uid: String(p.uid) }, { uid: true });
          } finally {
            lock.release();
          }
          break;
        }
        case "append": {
          const path = folderPath(p.folderId);
          if (!path) break;
          await client.append(path, Buffer.from(p.raw, "base64"), p.flags ?? ["\\Seen"]);
          break;
        }
        case "mkfolder": {
          const path = folderPath(p.folderId);
          if (!path) break;
          try {
            await client.mailboxCreate(path);
          } catch {
            /* already exists */
          }
          try {
            await client.mailboxSubscribe(path);
          } catch {}
          break;
        }
      }
      d.prepare("DELETE FROM pending_ops WHERE id = ?").run(op.id);
      done++;
    } catch (e) {
      const msg = (e as Error).message;
      if (op.attempts + 1 >= 8) {
        d.prepare("DELETE FROM pending_ops WHERE id = ?").run(op.id);
        d.prepare("INSERT INTO audit_log (user_id, actor, action, detail) VALUES (?,?,?,?)").run(acc.user_id, "system", "op_dropped", `${op.kind}: ${msg}`);
      } else {
        d.prepare("UPDATE pending_ops SET attempts = attempts + 1, last_error = ? WHERE id = ?").run(msg, op.id);
      }
    }
  }
  return done;
}

export async function runCycle(client: ImapFlow, acc: AccountRow, opts: { dirty?: () => boolean; full?: boolean } = {}) {
  const d = db();
  setState(acc, "syncing");
  await syncFolderList(client, acc);
  await drainOps(client, acc);
  const folders = d
    .prepare("SELECT id, special_use FROM folders WHERE account_id = ? AND sync_enabled = 1 ORDER BY CASE special_use WHEN 'inbox' THEN 0 WHEN 'sent' THEN 1 WHEN 'archive' THEN 2 ELSE 3 END")
    .all(acc.id) as { id: string; special_use: string | null }[];
  const deadline = Date.now() + BACKFILL_BUDGET_MS;
  for (const f of folders) {
    await syncFolder(client, acc, f.id, { deadline: opts.full ? undefined : deadline, onOpsDirty: opts.dirty });
    if (opts.dirty?.()) {
      await drainOps(client, acc);
    }
  }
  setState(acc, "idle");
  publish(acc.user_id, { type: "mail", accountId: acc.id, reason: "cycle" });
}

/** One-shot sync (used by tests, "sync now" fallbacks and CLI). */
export async function syncAccountOnce(accountId: string, opts: { full?: boolean } = {}) {
  const acc = getAccount(accountId);
  if (!acc) throw new Error("account not found");
  const client = makeClient(acc);
  try {
    await client.connect();
    await runCycle(client, acc, { full: opts.full ?? true });
  } catch (e) {
    setState(acc, "error", (e as Error).message);
    throw e;
  } finally {
    try {
      await client.logout();
    } catch {}
  }
}

export async function testImap(cfg: { host: string; port: number; secure: boolean; user: string; pass: string; rejectUnauthorized: boolean }) {
  const c = new ImapFlow({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: { user: cfg.user, pass: cfg.pass }, logger: false, tls: { rejectUnauthorized: cfg.rejectUnauthorized }, connectionTimeout: 15000, greetingTimeout: 15000 });
  c.on("error", () => {});
  await c.connect();
  await c.logout();
}

export class AccountSync {
  private running = false;
  private dirty = false;
  private wakeResolve: (() => void) | null = null;

  constructor(public accountId: string) {}

  start() {
    if (this.running) return;
    this.running = true;
    wakers.set(this.accountId, () => this.trigger());
    void this.loop();
  }

  stop() {
    this.running = false;
    wakers.delete(this.accountId);
    this.wakeResolve?.();
  }

  trigger() {
    this.dirty = true;
    this.wakeResolve?.();
  }

  private async loop() {
    let backoff = 2000;
    while (this.running) {
      const acc = getAccount(this.accountId);
      if (!acc) return;
      const client = makeClient(acc);
      let closed = false;
      const onClose = new Promise<void>((res) => client.on("close", () => { closed = true; res(); }));
      try {
        await client.connect();
        backoff = 2000;
        client.on("exists", () => this.trigger());
        client.on("expunge", () => this.trigger());
        client.on("flags", () => this.trigger());
        while (this.running && !closed) {
          this.dirty = false;
          const fresh = getAccount(this.accountId);
          if (!fresh) return;
          await runCycle(client, fresh, { dirty: () => this.dirty });
          if (this.dirty) continue;
          await this.idleWait(client, onClose);
        }
      } catch (e) {
        const msg = (e as Error).message || "connection failed";
        const a2 = getAccount(this.accountId);
        if (a2) setState(a2, "error", msg);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 120_000);
      } finally {
        try {
          if (!closed) await client.logout();
        } catch {}
      }
    }
  }

  private async idleWait(client: ImapFlow, onClose: Promise<void>) {
    const woke = new Promise<void>((res) => {
      this.wakeResolve = res;
    });
    let lock: { release: () => void } | null = null;
    try {
      lock = await client.getMailboxLock("INBOX");
      client.idle().catch(() => {});
      await Promise.race([woke, onClose, sleep(POLL_MS)]);
    } finally {
      this.wakeResolve = null;
      lock?.release();
    }
  }
}

const g = globalThis as unknown as { __mmsyncs?: Map<string, AccountSync> };
export const syncs = (g.__mmsyncs ??= new Map<string, AccountSync>());

export function startAccountSync(id: string) {
  if (env.syncDisabled) return;
  let s = syncs.get(id);
  if (!s) {
    s = new AccountSync(id);
    syncs.set(id, s);
  }
  s.start();
}

export function stopAccountSync(id: string) {
  syncs.get(id)?.stop();
  syncs.delete(id);
}

export function startAllSyncs() {
  const rows = db().prepare("SELECT id FROM mail_accounts").all() as { id: string }[];
  for (const r of rows) startAccountSync(r.id);
}

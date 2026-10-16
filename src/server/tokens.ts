import { db } from "./db";
import { randomToken, sha256, uid } from "./crypto";
import type { Scope, ToolCtx } from "./tools";

const VALID: Scope[] = ["read", "write", "send"];

export type TokenInfo = { id: string; name: string; prefix: string; scopes: Scope[]; lastUsedAt: number | null; createdAt: number };

function normalizeScopes(s: string[]): Scope[] {
  const set = new Set(s.filter((x): x is Scope => VALID.includes(x as Scope)));
  if (set.has("send")) set.add("write");
  if (set.has("write")) set.add("read");
  if (!set.size) set.add("read");
  return VALID.filter((x) => set.has(x));
}

/** Returns the plaintext token exactly once; only a hash is stored. */
export function createToken(userId: string, name: string, scopes: string[]): { token: string; info: TokenInfo } {
  const token = randomToken("mm");
  const id = uid();
  const sc = normalizeScopes(scopes);
  db().prepare("INSERT INTO api_tokens (id, user_id, name, token_hash, prefix, scopes) VALUES (?,?,?,?,?,?)").run(id, userId, name.slice(0, 60) || "token", sha256(token), token.slice(0, 9), sc.join(","));
  return { token, info: { id, name, prefix: token.slice(0, 9), scopes: sc, lastUsedAt: null, createdAt: Math.floor(Date.now() / 1000) } };
}

export function listTokens(userId: string): TokenInfo[] {
  const rows = db().prepare("SELECT id, name, prefix, scopes, last_used_at, created_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC").all(userId) as { id: string; name: string; prefix: string; scopes: string; last_used_at: number | null; created_at: number }[];
  return rows.map((r) => ({ id: r.id, name: r.name, prefix: r.prefix, scopes: r.scopes.split(",") as Scope[], lastUsedAt: r.last_used_at, createdAt: r.created_at }));
}

export function revokeToken(userId: string, id: string) {
  db().prepare("DELETE FROM api_tokens WHERE id = ? AND user_id = ?").run(id, userId);
}

export function verifyToken(plain: string): ToolCtx | null {
  if (!plain.startsWith("mm_")) return null;
  const r = db().prepare("SELECT id, user_id, name, scopes FROM api_tokens WHERE token_hash = ?").get(sha256(plain)) as { id: string; user_id: string; name: string; scopes: string } | undefined;
  if (!r) return null;
  db().prepare("UPDATE api_tokens SET last_used_at = unixepoch() WHERE id = ?").run(r.id);
  return { userId: r.user_id, actor: `mcp:${r.name}`, scopes: new Set(r.scopes.split(",") as Scope[]) };
}

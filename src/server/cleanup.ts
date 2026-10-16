import { db } from "./db";
import { userAccounts } from "./mail/accounts";

export type CleanupSuggestion = { id: string; title: string; description: string; query: string; count: number; action: "archive" | "trash" | "read" };

/** Cheap, deterministic inbox clean-up ideas (no AI needed). */
export function cleanupSuggestions(userId: string): CleanupSuggestion[] {
  const ids = userAccounts(userId).map((a) => a.id);
  if (!ids.length) return [];
  const ph = ids.map(() => "?").join(",");
  const base = `FROM messages m JOIN folders f ON f.id = m.folder_id WHERE m.account_id IN (${ph}) AND f.special_use = 'inbox'`;
  const count = (extra: string, ...p: unknown[]) => (db().prepare(`SELECT COUNT(DISTINCT m.thread_id) c ${base} AND ${extra}`).get(...ids, ...p) as { c: number }).c;
  const week = Math.floor(Date.now() / 1000) - 7 * 86400;
  const month = Math.floor(Date.now() / 1000) - 30 * 86400;
  const out: CleanupSuggestion[] = [];
  const promo = count("m.category = 'promotions' AND m.date < ?", week);
  if (promo) out.push({ id: "promos", title: "Archive old promotions", description: `${promo} promotional threads older than a week`, query: "category:promotions before:7d in:inbox", count: promo, action: "archive" });
  const news = count("m.category = 'newsletters' AND m.seen = 1 AND m.date < ?", week);
  if (news) out.push({ id: "news-read", title: "Archive read newsletters", description: `${news} newsletters you've already read`, query: "category:newsletters is:read in:inbox", count: news, action: "archive" });
  const stale = count("m.seen = 0 AND m.date < ? AND (m.category IN ('newsletters','promotions','social','updates'))", month);
  if (stale) out.push({ id: "stale", title: "Clear month-old unread notifications", description: `${stale} unread automated threads older than 30 days`, query: "is:unread before:30d in:inbox -category:primary", count: stale, action: "archive" });
  const social = count("m.category = 'social' AND m.date < ?", week);
  if (social) out.push({ id: "social", title: "Archive old social notifications", description: `${social} social threads older than a week`, query: "category:social before:7d in:inbox", count: social, action: "archive" });
  return out;
}

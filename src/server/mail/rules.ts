import { db } from "../db";
import { uid } from "../crypto";
import type { RuleAction, RuleCondition } from "@/lib/types";
import type { MsgRow } from "./rows";
import { archiveMessage, ensureFolder, findFolder, moveMessage, setFlags, trashMessage } from "./ops";
import type { FolderRole } from "@/lib/types";

type RuleRow = { id: string; user_id: string; name: string; enabled: number; match_all: number; conditions: string; actions: string; hits: number };

export function matchCondition(c: RuleCondition, m: MsgRow, accountEmail: string, hasList: boolean): boolean {
  const val = (c.value ?? "").toLowerCase();
  const test = (hay: string) => {
    const h = hay.toLowerCase();
    if (c.op === "equals") return h === val;
    if (c.op === "not_contains") return !h.includes(val);
    return h.includes(val);
  };
  switch (c.field) {
    case "from": return test(`${m.from_name} <${m.from_addr}>`);
    case "to": return test(`${m.to_json} ${m.cc_json}`);
    case "subject": return test(m.subject);
    case "body": return test(m.body_text ?? m.snippet);
    case "category": return (m.category ?? "") === val;
    case "account": return test(accountEmail);
    case "has_attachment": return !!m.has_attachments === (c.op !== "not_contains");
    case "list": return hasList === (c.op !== "not_contains");
  }
}

export function matches(rule: { matchAll: boolean; conditions: RuleCondition[] }, m: MsgRow, accountEmail: string, hasList: boolean): boolean {
  if (!rule.conditions.length) return false;
  const f = (c: RuleCondition) => matchCondition(c, m, accountEmail, hasList);
  return rule.matchAll ? rule.conditions.every(f) : rule.conditions.some(f);
}

export function getOrCreateLabel(userId: string, name: string, color?: string): string {
  const clean = name.trim().slice(0, 40);
  const ex = db().prepare("SELECT id FROM labels WHERE user_id = ? AND lower(name) = lower(?)").get(userId, clean) as { id: string } | undefined;
  if (ex) return ex.id;
  const id = uid();
  const palette = ["#f97316", "#10b981", "#3b82f6", "#a855f7", "#ec4899", "#eab308", "#14b8a6", "#ef4444"];
  const c = color || palette[Math.floor(Math.random() * palette.length)];
  db().prepare("INSERT INTO labels (id, user_id, name, color) VALUES (?,?,?,?)").run(id, userId, clean, c);
  return id;
}

export function addLabel(userId: string, mid: string, name: string, source: "user" | "ai" | "rule" = "user") {
  const lid = getOrCreateLabel(userId, name);
  db().prepare("INSERT OR IGNORE INTO message_labels (message_id, label_id, source) VALUES (?,?,?)").run(mid, lid, source);
}

export function runActions(userId: string, m: MsgRow, actions: RuleAction[], source: "rule" | "user" = "rule") {
  for (const a of actions) {
    switch (a.type) {
      case "label": addLabel(userId, m.id, a.value, source); break;
      case "mark_read": setFlags(m.id, { seen: true }); break;
      case "star": setFlags(m.id, { flagged: true }); break;
      case "archive": archiveMessage(m.id); break;
      case "trash": trashMessage(m.id); break;
      case "set_category": db().prepare("UPDATE messages SET category = ?, ai_state = CASE WHEN ai_state='pending' THEN 'pending' ELSE ai_state END WHERE id = ?").run(a.value, m.id); break;
      case "move": {
        const roles = ["inbox", "sent", "drafts", "trash", "junk", "archive"];
        let dest: { id: string } | undefined;
        if (roles.includes(a.value)) dest = ensureFolder(m.account_id, a.value as Exclude<FolderRole, null>);
        else dest = db().prepare("SELECT id FROM folders WHERE account_id = ? AND (path = ? OR name = ?)").get(m.account_id, a.value, a.value) as { id: string } | undefined;
        if (dest) moveMessage(m.id, dest.id);
        break;
      }
    }
  }
}

export function loadRules(userId: string) {
  const rows = db().prepare("SELECT * FROM rules WHERE user_id = ? AND enabled = 1 ORDER BY created_at").all(userId) as RuleRow[];
  return rows.map((r) => ({
    id: r.id,
    matchAll: !!r.match_all,
    conditions: JSON.parse(r.conditions) as RuleCondition[],
    actions: JSON.parse(r.actions) as RuleAction[],
  }));
}

/** Apply all enabled rules to a freshly ingested message. Returns the ids of rules that fired. */
export function applyRules(userId: string, m: MsgRow, accountEmail: string, hasList: boolean): string[] {
  const fired: string[] = [];
  for (const r of loadRules(userId)) {
    if (matches(r, m, accountEmail, hasList)) {
      runActions(userId, m, r.actions);
      db().prepare("UPDATE rules SET hits = hits + 1 WHERE id = ?").run(r.id);
      fired.push(r.id);
      if (r.actions.some((a) => ["archive", "trash", "move"].includes(a.type))) break; // message left the inbox
    }
  }
  return fired;
}

export { findFolder };

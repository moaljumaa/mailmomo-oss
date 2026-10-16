import type { FolderRole } from "@/lib/types";

export type ParsedQuery = {
  text: string[];
  from: string[];
  to: string[];
  subject: string[];
  label: string[];
  category: string[];
  inFolder?: string;
  hasAttachment?: boolean;
  unread?: boolean;
  read?: boolean;
  starred?: boolean;
  snoozed?: boolean;
  needsReply?: boolean;
  before?: number;
  after?: number;
  account?: string;
  negated: { from: string[]; label: string[]; text: string[]; category: string[] };
};

const DAY = 86400;

function parseDate(v: string, now = Date.now()): number | undefined {
  const rel = v.match(/^(\d+)([dwmy])$/i);
  if (rel) {
    const n = Number(rel[1]);
    const mult = { d: DAY, w: 7 * DAY, m: 30 * DAY, y: 365 * DAY }[rel[2].toLowerCase() as "d" | "w" | "m" | "y"];
    return Math.floor(now / 1000) - n * mult;
  }
  const t = Date.parse(v.replace(/\//g, "-"));
  return Number.isNaN(t) ? undefined : Math.floor(t / 1000);
}

/** Parse `from:x subject:"a b" has:attachment is:unread label:work -from:y free text` */
export function parseQuery(input: string, now = Date.now()): ParsedQuery {
  const q: ParsedQuery = { text: [], from: [], to: [], subject: [], label: [], category: [], negated: { from: [], label: [], text: [], category: [] } };
  const re = /(-?)(?:(\w+):)?("([^"]*)"|\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    const neg = m[1] === "-";
    const key = (m[2] || "").toLowerCase();
    const val = (m[4] ?? m[3]).replace(/^"|"$/g, "");
    if (!val) continue;
    if (!key) {
      (neg ? q.negated.text : q.text).push(val);
      continue;
    }
    switch (key) {
      case "from": (neg ? q.negated.from : q.from).push(val); break;
      case "to": q.to.push(val); break;
      case "subject": q.subject.push(val); break;
      case "label": case "l": (neg ? q.negated.label : q.label).push(val); break;
      case "category": case "cat": (neg ? q.negated.category : q.category).push(val.toLowerCase()); break;
      case "in": q.inFolder = val.toLowerCase(); break;
      case "account": q.account = val; break;
      case "has": if (val.toLowerCase().startsWith("attach")) q.hasAttachment = true; break;
      case "is": {
        const v = val.toLowerCase();
        if (v === "unread") q.unread = true;
        else if (v === "read") q.read = true;
        else if (v === "starred" || v === "flagged") q.starred = true;
        else if (v === "snoozed") q.snoozed = true;
        else if (v === "needsreply" || v === "reply") q.needsReply = true;
        break;
      }
      case "before": q.before = parseDate(val, now); break;
      case "after": case "since": q.after = parseDate(val, now); break;
      case "older": q.before = parseDate(val, now); break;
      case "newer": q.after = parseDate(val, now); break;
      default:
        // unknown operator: treat whole token as text
        (neg ? q.negated.text : q.text).push(`${key} ${val}`);
    }
  }
  return q;
}

export function ftsExpr(terms: string[]): string {
  return terms
    .flatMap((t) => t.split(/\s+/))
    .map((t) => t.replace(/["*^():{}\[\]-]/g, "").trim())
    .filter(Boolean)
    .map((t) => `"${t}"*`)
    .join(" ");
}

const ROLE_ALIASES: Record<string, FolderRole> = {
  inbox: "inbox", sent: "sent", drafts: "drafts", draft: "drafts", trash: "trash", bin: "trash",
  spam: "junk", junk: "junk", archive: "archive", all: "all", anywhere: "all",
};
export function roleFromAlias(s: string): FolderRole | undefined {
  return ROLE_ALIASES[s.toLowerCase()];
}

export type SqlParts = { where: string[]; params: unknown[]; inRole: FolderRole | "all" | undefined };

/** Build WHERE fragments against `messages m` (join folders f). Caller adds scope (user accounts). */
export function buildSearchSql(pq: ParsedQuery): SqlParts {
  const where: string[] = [];
  const params: unknown[] = [];
  let inRole: FolderRole | "all" | undefined;
  if (pq.inFolder) {
    const r = roleFromAlias(pq.inFolder);
    if (r === "all") inRole = "all";
    else if (r) {
      inRole = r;
      where.push("f.special_use = ?");
      params.push(r);
    } else {
      where.push("lower(f.name) = ?");
      params.push(pq.inFolder);
    }
  }
  const fts = ftsExpr(pq.text);
  if (fts) {
    where.push("m.rowid IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)");
    params.push(fts);
  }
  for (const t of pq.negated.text) {
    const e = ftsExpr([t]);
    if (e) {
      where.push("m.rowid NOT IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)");
      params.push(e);
    }
  }
  for (const v of pq.from) {
    where.push("(m.from_addr LIKE ? ESCAPE '\\' OR m.from_name LIKE ? ESCAPE '\\')");
    const l = `%${esc(v)}%`;
    params.push(l, l);
  }
  for (const v of pq.negated.from) {
    where.push("(m.from_addr NOT LIKE ? ESCAPE '\\' AND m.from_name NOT LIKE ? ESCAPE '\\')");
    const l = `%${esc(v)}%`;
    params.push(l, l);
  }
  for (const v of pq.to) {
    where.push("(m.to_json LIKE ? ESCAPE '\\' OR m.cc_json LIKE ? ESCAPE '\\')");
    const l = `%${esc(v)}%`;
    params.push(l, l);
  }
  for (const v of pq.subject) {
    where.push("m.subject LIKE ? ESCAPE '\\'");
    params.push(`%${esc(v)}%`);
  }
  for (const v of pq.label) {
    where.push("EXISTS (SELECT 1 FROM message_labels ml JOIN labels l ON l.id = ml.label_id WHERE ml.message_id = m.id AND lower(l.name) = ?)");
    params.push(v.toLowerCase());
  }
  for (const v of pq.negated.label) {
    where.push("NOT EXISTS (SELECT 1 FROM message_labels ml JOIN labels l ON l.id = ml.label_id WHERE ml.message_id = m.id AND lower(l.name) = ?)");
    params.push(v.toLowerCase());
  }
  if (pq.category.length) {
    where.push(`m.category IN (${pq.category.map(() => "?").join(",")})`);
    params.push(...pq.category);
  }
  if (pq.negated.category.length) {
    where.push(`coalesce(m.category, 'primary') NOT IN (${pq.negated.category.map(() => "?").join(",")})`);
    params.push(...pq.negated.category);
  }
  if (pq.hasAttachment) where.push("m.has_attachments = 1");
  if (pq.unread) where.push("m.seen = 0");
  if (pq.read) where.push("m.seen = 1");
  if (pq.starred) where.push("m.flagged = 1");
  if (pq.needsReply) where.push("m.needs_reply = 1");
  if (pq.snoozed) where.push("m.snoozed_until IS NOT NULL AND m.snoozed_until > unixepoch()");
  if (pq.before) { where.push("m.date < ?"); params.push(pq.before); }
  if (pq.after) { where.push("m.date > ?"); params.push(pq.after); }
  return { where, params, inRole };
}

function esc(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

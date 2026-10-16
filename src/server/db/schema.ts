export const SCHEMA_VERSION = 1;

export const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS mail_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  imap_host TEXT NOT NULL,
  imap_port INTEGER NOT NULL DEFAULT 993,
  imap_secure INTEGER NOT NULL DEFAULT 1,
  imap_user TEXT NOT NULL,
  imap_pass TEXT NOT NULL,          -- encrypted
  smtp_host TEXT NOT NULL,
  smtp_port INTEGER NOT NULL DEFAULT 587,
  smtp_secure INTEGER NOT NULL DEFAULT 0,
  smtp_user TEXT NOT NULL,
  smtp_pass TEXT NOT NULL,          -- encrypted
  signature TEXT NOT NULL DEFAULT '',
  tls_reject_unauthorized INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  sync_state TEXT NOT NULL DEFAULT 'idle',   -- idle|syncing|error
  sync_error TEXT,
  last_synced_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON mail_accounts(user_id);

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  special_use TEXT,                 -- inbox|sent|drafts|trash|junk|archive|all|null
  uidvalidity TEXT,
  uidnext INTEGER NOT NULL DEFAULT 1,
  highestmodseq TEXT,
  last_uid INTEGER NOT NULL DEFAULT 0,
  backfill_before_uid INTEGER,      -- lowest uid already fetched (for backfill)
  sync_enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE(account_id, path)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
  folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  uid INTEGER NOT NULL,
  message_id TEXT,
  in_reply_to TEXT,
  refs TEXT,                        -- space separated
  thread_id TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  from_name TEXT NOT NULL DEFAULT '',
  from_addr TEXT NOT NULL DEFAULT '',
  to_json TEXT NOT NULL DEFAULT '[]',
  cc_json TEXT NOT NULL DEFAULT '[]',
  reply_to TEXT,
  date INTEGER NOT NULL,
  snippet TEXT NOT NULL DEFAULT '',
  body_text TEXT,
  body_html TEXT,                   -- sanitized
  has_attachments INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 0,
  seen INTEGER NOT NULL DEFAULT 0,
  flagged INTEGER NOT NULL DEFAULT 0,
  answered INTEGER NOT NULL DEFAULT 0,
  draft INTEGER NOT NULL DEFAULT 0,
  list_unsubscribe TEXT,
  -- AI + workflow state
  category TEXT,
  priority INTEGER,                 -- 0..3
  summary TEXT,
  needs_reply INTEGER NOT NULL DEFAULT 0,
  ai_state TEXT NOT NULL DEFAULT 'pending',  -- pending|done|skipped|error
  snoozed_until INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(folder_id, uid)
);
CREATE INDEX IF NOT EXISTS idx_msg_folder_date ON messages(folder_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_msg_thread ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_msg_msgid ON messages(account_id, message_id);
CREATE INDEX IF NOT EXISTS idx_msg_account_date ON messages(account_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_msg_ai ON messages(ai_state);
CREATE INDEX IF NOT EXISTS idx_msg_snooze ON messages(snoozed_until) WHERE snoozed_until IS NOT NULL;

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  subject, from_text, to_text, body,
  content='messages', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, subject, from_text, to_text, body)
  VALUES (new.rowid, new.subject, new.from_name || ' ' || new.from_addr, new.to_json, coalesce(new.body_text, new.snippet));
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, subject, from_text, to_text, body)
  VALUES ('delete', old.rowid, old.subject, old.from_name || ' ' || old.from_addr, old.to_json, coalesce(old.body_text, old.snippet));
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF subject, from_name, from_addr, to_json, body_text ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, subject, from_text, to_text, body)
  VALUES ('delete', old.rowid, old.subject, old.from_name || ' ' || old.from_addr, old.to_json, coalesce(old.body_text, old.snippet));
  INSERT INTO messages_fts(rowid, subject, from_text, to_text, body)
  VALUES (new.rowid, new.subject, new.from_name || ' ' || new.from_addr, new.to_json, coalesce(new.body_text, new.snippet));
END;

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,             -- index in parsed attachment list
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  cid TEXT,
  inline INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_att_msg ON attachments(message_id);

CREATE TABLE IF NOT EXISTS labels (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#94a3b8',
  UNIQUE(user_id, name)
);
CREATE TABLE IF NOT EXISTS message_labels (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'user',   -- user|ai|rule
  PRIMARY KEY (message_id, label_id)
);
CREATE INDEX IF NOT EXISTS idx_ml_label ON message_labels(label_id);

CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  match_all INTEGER NOT NULL DEFAULT 1,
  conditions TEXT NOT NULL,         -- json
  actions TEXT NOT NULL,            -- json
  source_text TEXT,                 -- natural language it came from
  hits INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  in_reply_to_message_id TEXT,      -- local messages.id
  to_json TEXT NOT NULL DEFAULT '[]',
  cc_json TEXT NOT NULL DEFAULT '[]',
  bcc_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  send_at INTEGER,                  -- scheduled send (unix s)
  status TEXT NOT NULL DEFAULT 'draft', -- draft|scheduled|sending|sent|failed
  error TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_drafts_user ON drafts(user_id, status);

CREATE TABLE IF NOT EXISTS draft_files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  draft_id TEXT,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  path TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_df_draft ON draft_files(draft_id);

CREATE TABLE IF NOT EXISTS pending_ops (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,               -- flags|move|delete|append
  payload TEXT NOT NULL,            -- json
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_ops_account ON pending_ops(account_id, created_at);

CREATE TABLE IF NOT EXISTS contacts (
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 1,
  last_seen INTEGER NOT NULL DEFAULT 0,
  load_images INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, email)
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT 'read',
  last_used_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS settings (
  user_id TEXT PRIMARY KEY,
  json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL DEFAULT (unixepoch()),
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost REAL                         -- USD, null when unknown
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_at ON ai_usage(at);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  actor TEXT NOT NULL,              -- ui|mcp:<token name>|ai|system
  action TEXT NOT NULL,
  detail TEXT,
  at INTEGER NOT NULL DEFAULT (unixepoch())
);
`;

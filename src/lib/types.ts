// Shared between server and client.
export type Addr = { name: string; address: string };

export type FolderRole = "inbox" | "sent" | "drafts" | "trash" | "junk" | "archive" | "all" | null;

export const CATEGORIES = ["primary", "updates", "newsletters", "promotions", "social"] as const;
export type Category = (typeof CATEGORIES)[number];

export type LabelDTO = { id: string; name: string; color: string; source?: string };

export type AccountDTO = {
  id: string;
  name: string;
  email: string;
  color: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUser: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  signature: string;
  syncState: string;
  syncError: string | null;
  lastSyncedAt: number | null;
};

export type FolderDTO = {
  id: string;
  accountId: string;
  path: string;
  name: string;
  role: FolderRole;
  unread: number;
  total: number;
};

export type ThreadSummary = {
  id: string; // id of the latest message in the view (used for message actions)
  threadId: string;
  accountId: string;
  folderId: string;
  subject: string;
  fromName: string;
  fromAddr: string;
  participants: string[];
  snippet: string;
  date: number;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  hasAttachments: boolean;
  category: Category | null;
  priority: number | null;
  summary: string | null;
  needsReply: boolean;
  snoozedUntil: number | null;
  labels: LabelDTO[];
  count: number;
  unreadCount: number;
};

export type AttachmentDTO = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  inline: boolean;
};

export type MessageDTO = {
  id: string;
  accountId: string;
  folderId: string;
  threadId: string;
  messageId: string | null;
  subject: string;
  from: Addr;
  to: Addr[];
  cc: Addr[];
  replyTo: string | null;
  date: number;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  bodyHtml: string | null;
  bodyText: string;
  hasRemoteImages: boolean;
  attachments: AttachmentDTO[];
  category: Category | null;
  priority: number | null;
  summary: string | null;
  needsReply: boolean;
  labels: LabelDTO[];
  listUnsubscribe: string | null;
  folderRole: FolderRole;
};

export type ThreadDTO = {
  threadId: string;
  subject: string;
  accountId: string;
  messages: MessageDTO[];
};

export type RuleCondition = {
  field: "from" | "to" | "subject" | "body" | "category" | "has_attachment" | "list" | "account";
  op: "contains" | "equals" | "not_contains" | "is_true";
  value?: string;
};
export type RuleAction =
  | { type: "label"; value: string }
  | { type: "archive" }
  | { type: "mark_read" }
  | { type: "star" }
  | { type: "trash" }
  | { type: "move"; value: string } // folder role or path
  | { type: "set_category"; value: Category };

export type RuleDTO = {
  id: string;
  name: string;
  enabled: boolean;
  matchAll: boolean;
  conditions: RuleCondition[];
  actions: RuleAction[];
  sourceText: string | null;
  hits: number;
};

export type DraftDTO = {
  id: string;
  accountId: string;
  inReplyToMessageId: string | null;
  to: Addr[];
  cc: Addr[];
  bcc: Addr[];
  subject: string;
  bodyHtml: string;
  bodyText: string;
  sendAt: number | null;
  status: string;
  error: string | null;
  updatedAt: number;
};

export type Settings = {
  aiEnabled: boolean;
  autoTriage: boolean;
  undoSendSeconds: number;
  splitTabs: Category[];
  theme: "system" | "light" | "dark";
  density: "comfortable" | "compact";
  readingPane: boolean;
  defaultAccountId: string | null;
  loadRemoteImages: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  aiEnabled: true,
  autoTriage: true,
  undoSendSeconds: 10,
  splitTabs: ["primary", "updates", "newsletters", "promotions", "social"],
  theme: "system",
  density: "comfortable",
  readingPane: true,
  defaultAccountId: null,
  loadRemoteImages: false,
};

export type ListQuery = {
  accountId?: string;
  folder?: string; // role name or folder id
  category?: Category | "all";
  label?: string;
  q?: string;
  unread?: boolean;
  starred?: boolean;
  snoozed?: boolean;
  needsReply?: boolean;
  limit?: number;
  offset?: number;
};

export type ServerEvent =
  | { type: "mail"; accountId: string; reason: string }
  | { type: "sync"; accountId: string; state: string; error?: string | null }
  | { type: "ai"; messageId: string }
  | { type: "sent"; draftId: string; ok: boolean; error?: string };

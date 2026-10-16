import { db } from "../db";
import { decrypt } from "../crypto";
import type { AccountDTO } from "@/lib/types";

export type AccountRow = {
  id: string; user_id: string; name: string; email: string; color: string;
  imap_host: string; imap_port: number; imap_secure: number; imap_user: string; imap_pass: string;
  smtp_host: string; smtp_port: number; smtp_secure: number; smtp_user: string; smtp_pass: string;
  signature: string; tls_reject_unauthorized: number; sort_order: number;
  sync_state: string; sync_error: string | null; last_synced_at: number | null;
};

export function getAccount(id: string): AccountRow | undefined {
  return db().prepare("SELECT * FROM mail_accounts WHERE id = ?").get(id) as AccountRow | undefined;
}

export function userAccount(userId: string, id: string): AccountRow {
  const a = db().prepare("SELECT * FROM mail_accounts WHERE id = ? AND user_id = ?").get(id, userId) as AccountRow | undefined;
  if (!a) throw new HttpError(404, "Account not found");
  return a;
}

export function userAccounts(userId: string): AccountRow[] {
  return db().prepare("SELECT * FROM mail_accounts WHERE user_id = ? ORDER BY sort_order, created_at").all(userId) as AccountRow[];
}

export function accountPasswords(a: AccountRow) {
  return { imap: decrypt(a.imap_pass), smtp: decrypt(a.smtp_pass) };
}

export function toAccountDTO(a: AccountRow): AccountDTO {
  return {
    id: a.id, name: a.name, email: a.email, color: a.color,
    imapHost: a.imap_host, imapPort: a.imap_port, imapSecure: !!a.imap_secure, imapUser: a.imap_user,
    smtpHost: a.smtp_host, smtpPort: a.smtp_port, smtpSecure: !!a.smtp_secure, smtpUser: a.smtp_user,
    signature: a.signature, syncState: a.sync_state, syncError: a.sync_error, lastSyncedAt: a.last_synced_at,
  };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

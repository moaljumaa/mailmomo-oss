import { expect, type Page } from "@playwright/test";
import { ImapFlow } from "imapflow";
import { E2E } from "./global-setup";

export const OWNER = { name: "Owner", email: "owner@mailmomo.test", password: "correct-horse-battery" };

export async function imapMessages(user: string, mailbox = "INBOX") {
  const c = new ImapFlow({ host: "127.0.0.1", port: E2E.imap, secure: false, auth: { user, pass: "pass" }, logger: false });
  c.on("error", () => {});
  await c.connect();
  try {
    const lock = await c.getMailboxLock(mailbox);
    try {
      const out: { subject: string; flags: string[]; text: string }[] = [];
      for await (const m of c.fetch("1:*", { envelope: true, flags: true, source: true })) out.push({ subject: m.envelope?.subject ?? "", flags: [...(m.flags ?? [])], text: m.source?.toString() ?? "" });
      return out;
    } finally { lock.release(); }
  } catch { return []; } finally { await c.logout(); }
}

export async function rows(page: Page) {
  return page.getByTestId("thread-row");
}

export async function waitForInbox(page: Page, minRows = 1) {
  await expect.poll(async () => page.getByTestId("thread-row").count(), { timeout: 40_000 }).toBeGreaterThanOrEqual(minRows);
}

export async function appendMail(user: string, raw: Buffer, mailbox = "INBOX") {
  const c = new ImapFlow({ host: "127.0.0.1", port: E2E.imap, secure: false, auth: { user, pass: "pass" }, logger: false });
  c.on("error", () => {});
  await c.connect();
  try { await c.append(mailbox, raw, []); } finally { await c.logout(); }
}

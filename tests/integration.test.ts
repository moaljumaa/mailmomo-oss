import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ImapFlow } from "imapflow";
import { startDevMail } from "../scripts/devmail.mjs";
import { eml } from "./helpers";
import { db } from "@/server/db";
import * as svc from "@/server/mail/service";
import { syncAccountOnce } from "@/server/mail/sync";
import { deliverDraft } from "@/server/mail/service";

const USER = "user-1";
let dev: Awaited<ReturnType<typeof startDevMail>>;
let accountId: string;

async function imap(user = "alice@test.local") {
  const c = new ImapFlow({ host: "127.0.0.1", port: 12143, secure: false, auth: { user, pass: "pass" }, logger: false });
  c.on("error", () => {});
  await c.connect();
  return c;
}
async function serverState(path: string, user = "alice@test.local") {
  const c = await imap(user);
  try {
    const lock = await c.getMailboxLock(path);
    try {
      const out: { uid: number; subject: string; flags: string[] }[] = [];
      for await (const m of c.fetch("1:*", { uid: true, flags: true, envelope: true }, { uid: true })) {
        out.push({ uid: m.uid, subject: m.envelope?.subject ?? "", flags: [...(m.flags ?? [])] });
      }
      return out;
    } finally {
      lock.release();
    }
  } catch {
    return [];
  } finally {
    await c.logout();
  }
}

beforeAll(async () => {
  dev = await startDevMail();
  db();
  await dev.deliverLocal("alice@test.local", eml({ from: "Bob Builder <bob@test.local>", to: "alice@test.local", subject: "Project kickoff", body: "Can we meet on Tuesday to kick off the project?", messageId: "<m1@test.local>", date: new Date(Date.now() - 3600_000).toUTCString() }));
  await dev.deliverLocal("alice@test.local", eml({ from: "Bob Builder <bob@test.local>", to: "alice@test.local", subject: "Re: Project kickoff", body: "Also bring the budget.", messageId: "<m2@test.local>", inReplyTo: "<m1@test.local>", references: "<m1@test.local>" }));
  await dev.deliverLocal("alice@test.local", eml({ from: "Shop <news@shop.example>", to: "alice@test.local", subject: "Weekly deals: 50% off", html: '<p>Big <b>sale</b></p><img src="https://track.example/p.gif"><script>alert(1)</script>', headers: { "List-Unsubscribe": "<mailto:unsub@shop.example>, <https://shop.example/u/1>", "List-Id": "<deals.shop.example>" } }));
  await dev.deliverLocal("alice@test.local", eml({ from: "Stripe <noreply@stripe.com>", to: "alice@test.local", subject: "Your invoice from ACME", body: "Invoice #1234 for $99. Pineapple." }));
}, 90_000);

afterAll(async () => {
  await dev?.stop();
});

describe("account + sync", () => {
  it("adds an account (verifying IMAP+SMTP) and syncs", async () => {
    const acc = await svc.addAccount(USER, {
      name: "Alice", email: "alice@test.local", imapHost: "127.0.0.1", imapPort: 12143, imapSecure: false, imapUser: "alice@test.local", imapPass: "pass",
      smtpHost: "127.0.0.1", smtpPort: 12025, smtpSecure: false, smtpUser: "alice@test.local", smtpPass: "pass", allowSelfSigned: true,
    });
    accountId = acc.id;
    await syncAccountOnce(accountId);
    const folders = svc.listFolders(USER);
    expect(folders.map((f) => f.role)).toEqual(expect.arrayContaining(["inbox", "sent", "drafts", "trash", "junk", "archive"]));
    expect(folders.find((f) => f.role === "inbox")!.total).toBe(4);
  });

  it("rejects bad credentials with a useful error", async () => {
    await expect(
      svc.addAccount(USER, {
        name: "x", email: "x@test.local", imapHost: "127.0.0.1", imapPort: 12143, imapSecure: false, imapUser: "alice@test.local", imapPass: "WRONG",
        smtpHost: "127.0.0.1", smtpPort: 12025, smtpSecure: false, smtpUser: "alice@test.local", smtpPass: "pass",
      }),
    ).rejects.toThrow(/IMAP/);
  });

  it("groups threads and categorizes", () => {
    const { threads } = svc.listThreads(USER, { folder: "inbox" });
    expect(threads).toHaveLength(3);
    const kick = threads.find((t) => t.subject.includes("kickoff"))!;
    expect(kick.count).toBe(2);
    expect(kick.unreadCount).toBe(2);
    expect(kick.category).toBe("primary");
    expect(threads.find((t) => t.subject.startsWith("Weekly"))!.category).toBe("promotions");
    expect(threads.find((t) => t.subject.includes("invoice"))!.category).toBe("updates");
  });

  it("filters by category", () => {
    expect(svc.listThreads(USER, { category: "promotions" }).threads).toHaveLength(1);
    expect(svc.listThreads(USER, { category: "primary" }).threads).toHaveLength(1);
  });

  it("sanitizes html, flags remote images, exposes unsubscribe", () => {
    const t = svc.listThreads(USER, { q: "Weekly" }).threads[0];
    const m = svc.getMessage(USER, t.id);
    expect(m.bodyHtml).toContain("sale");
    expect(m.bodyHtml).not.toMatch(/<script/i);
    expect(m.hasRemoteImages).toBe(true);
    expect(svc.unsubscribeInfo(USER, m.id)).toEqual({ mailto: "mailto:unsub@shop.example", url: "https://shop.example/u/1" });
  });

  it("full-text search with operators", () => {
    expect(svc.listThreads(USER, { q: "pineapple" }).threads).toHaveLength(1);
    expect(svc.listThreads(USER, { q: "from:stripe" }).threads).toHaveLength(1);
    expect(svc.listThreads(USER, { q: "subject:kickoff is:unread" }).threads).toHaveLength(1);
    expect(svc.listThreads(USER, { q: "budget" }).threads[0].subject).toContain("kickoff");
    expect(svc.listThreads(USER, { q: "nonexistentword" }).threads).toHaveLength(0);
    expect(svc.listThreads(USER, { q: "has:attachment" }).threads).toHaveLength(0);
  });
});

describe("actions round-trip to the IMAP server", () => {
  it("mark read", async () => {
    const t = svc.listThreads(USER, { q: "kickoff" }).threads[0];
    svc.actOnThreads(USER, [t.threadId], { type: "read" });
    expect(svc.listThreads(USER, { q: "kickoff" }).threads[0].unreadCount).toBe(0); // optimistic
    await syncAccountOnce(accountId);
    const st = await serverState("INBOX");
    const k = st.filter((m) => m.subject.includes("kickoff"));
    expect(k.every((m) => m.flags.includes("\\Seen"))).toBe(true);
  });

  it("star", async () => {
    const t = svc.listThreads(USER, { q: "invoice" }).threads[0];
    svc.actOnThreads(USER, [t.threadId], { type: "star" });
    await syncAccountOnce(accountId);
    const st = await serverState("INBOX");
    expect(st.find((m) => m.subject.includes("invoice"))!.flags).toContain("\\Flagged");
    expect(svc.listThreads(USER, { starred: true }).threads).toHaveLength(1);
  });

  it("archive moves the message on the server and locally", async () => {
    const t = svc.listThreads(USER, { q: "Weekly" }).threads[0];
    svc.actOnThreads(USER, [t.threadId], { type: "archive" });
    expect(svc.listThreads(USER, { folder: "inbox" }).threads.some((x) => x.subject.startsWith("Weekly"))).toBe(false);
    await syncAccountOnce(accountId);
    expect((await serverState("INBOX")).some((m) => m.subject.startsWith("Weekly"))).toBe(false);
    expect((await serverState("Archive")).some((m) => m.subject.startsWith("Weekly"))).toBe(true);
    // after sync the local row has a real uid and exactly one copy
    const rows = db().prepare("SELECT uid FROM messages WHERE subject LIKE 'Weekly%'").all() as { uid: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].uid).toBeGreaterThan(0);
    expect(svc.listThreads(USER, { folder: "archive" }).threads).toHaveLength(1);
  });

  it("trash then delete forever", async () => {
    const t = svc.listThreads(USER, { q: "invoice" }).threads[0];
    svc.actOnThreads(USER, [t.threadId], { type: "trash" });
    await syncAccountOnce(accountId);
    expect((await serverState("Trash")).some((m) => m.subject.includes("invoice"))).toBe(true);
    const tt = svc.listThreads(USER, { folder: "trash" }).threads[0];
    svc.actOnThreads(USER, [tt.threadId], { type: "delete_forever" });
    await syncAccountOnce(accountId);
    expect((await serverState("Trash")).some((m) => m.subject.includes("invoice"))).toBe(false);
  });

  it("snooze hides from inbox until due", () => {
    const t = svc.listThreads(USER, { folder: "inbox" }).threads[0];
    svc.actOnThreads(USER, [t.threadId], { type: "snooze", until: Math.floor(Date.now() / 1000) + 3600 });
    expect(svc.listThreads(USER, { folder: "inbox" }).threads.some((x) => x.threadId === t.threadId)).toBe(false);
    expect(svc.listThreads(USER, { snoozed: true }).threads).toHaveLength(1);
    db().prepare("UPDATE messages SET snoozed_until = unixepoch() - 1 WHERE thread_id = ?").run(t.threadId);
    svc.snoozeTick();
    expect(svc.listThreads(USER, { folder: "inbox" }).threads.some((x) => x.threadId === t.threadId)).toBe(true);
  });

  it("labels", () => {
    const t = svc.listThreads(USER, { folder: "inbox" }).threads[0];
    svc.actOnThreads(USER, [t.threadId], { type: "label", name: "Work" });
    expect(svc.listThreads(USER, { label: "work" }).threads).toHaveLength(1);
    expect(svc.listLabels(USER)[0]).toMatchObject({ name: "Work", count: 1 });
    svc.actOnThreads(USER, [t.threadId], { type: "unlabel", name: "work" });
    expect(svc.listThreads(USER, { label: "work" }).threads).toHaveLength(0);
  });
});

describe("server-side changes are picked up", () => {
  it("new mail, external flag changes, external deletion", async () => {
    await dev.deliverLocal("alice@test.local", eml({ from: "Carol <carol@test.local>", to: "alice@test.local", subject: "Lunch?", body: "Free today?" }));
    await syncAccountOnce(accountId);
    expect(svc.listThreads(USER, { q: "lunch" }).threads).toHaveLength(1);

    const c = await imap();
    const lock = await c.getMailboxLock("INBOX");
    try {
      const uids = (await c.search({ subject: "Lunch" }, { uid: true })) as number[];
      await c.messageFlagsAdd(uids.join(","), ["\\Seen"], { uid: true });
    } finally { lock.release(); await c.logout(); }
    await syncAccountOnce(accountId);
    expect(svc.listThreads(USER, { q: "lunch" }).threads[0].seen).toBe(true);

    const c2 = await imap();
    const l2 = await c2.getMailboxLock("INBOX");
    try {
      const uids = (await c2.search({ subject: "Lunch" }, { uid: true })) as number[];
      await c2.messageDelete(uids.join(","), { uid: true });
    } finally { l2.release(); await c2.logout(); }
    await syncAccountOnce(accountId);
    expect(svc.listThreads(USER, { q: "lunch" }).threads).toHaveLength(0);
  });
});

describe("rules", () => {
  it("applies on arrival: label + archive", async () => {
    svc.createRule(USER, {
      name: "Receipts", conditions: [{ field: "subject", op: "contains", value: "receipt" }],
      actions: [{ type: "label", value: "Receipts" }, { type: "mark_read" }, { type: "archive" }],
    });
    await dev.deliverLocal("alice@test.local", eml({ from: "Shop <orders@shop.example>", to: "alice@test.local", subject: "Your receipt #9", body: "thanks" }));
    await syncAccountOnce(accountId);
    expect(svc.listThreads(USER, { folder: "inbox", q: "receipt" }).threads).toHaveLength(0);
    const found = svc.listThreads(USER, { label: "receipts" }).threads;
    expect(found).toHaveLength(1);
    expect(found[0].seen).toBe(true);
    await syncAccountOnce(accountId);
    expect((await serverState("Archive")).some((m) => m.subject.includes("receipt"))).toBe(true);
    expect(svc.listRules(USER)[0].hits).toBe(1);
  });
});

describe("compose, send, reply", () => {
  it("sends via SMTP, copies to Sent, delivered to recipient", async () => {
    const before = dev.outbox.length;
    const draft = svc.createDraft(USER, { to: [{ name: "Bob", address: "bob@test.local" }], subject: "Hello from Mailmomo", bodyHtml: "<p>Hi <b>Bob</b></p>" });
    svc.sendDraft(USER, draft.id, { delaySeconds: 0 });
    await deliverDraft(draft.id);
    expect(svc.getDraft(USER, draft.id).status).toBe("sent");
    expect(dev.outbox.length).toBe(before + 1);
    expect(dev.outbox.at(-1)!.to).toEqual(["bob@test.local"]);
    expect(dev.outbox.at(-1)!.raw.toString()).toContain("Hello from Mailmomo");
    await syncAccountOnce(accountId);
    expect((await serverState("Sent")).some((m) => m.subject === "Hello from Mailmomo")).toBe(true);
    expect((await serverState("INBOX", "bob@test.local")).some((m) => m.subject === "Hello from Mailmomo")).toBe(true);
    await syncAccountOnce(accountId);
    expect(svc.listThreads(USER, { folder: "sent" }).threads.some((t) => t.subject === "Hello from Mailmomo")).toBe(true);
  });

  it("undo send cancels a scheduled draft", () => {
    const d = svc.createDraft(USER, { to: [{ name: "", address: "bob@test.local" }], subject: "Oops" });
    svc.sendDraft(USER, d.id, { delaySeconds: 30 });
    expect(svc.getDraft(USER, d.id).status).toBe("scheduled");
    svc.cancelSend(USER, d.id);
    expect(svc.getDraft(USER, d.id).status).toBe("draft");
  });

  it("builds reply drafts with correct recipients, subject and threading", async () => {
    const t = svc.listThreads(USER, { q: "kickoff" }).threads[0];
    const d = svc.createReplyDraft(USER, t.id, "reply");
    expect(d.to.map((a) => a.address)).toEqual(["bob@test.local"]);
    expect(d.subject).toBe("Re: Project kickoff");
    expect(d.bodyHtml).toContain("wrote:");
    svc.updateDraft(USER, d.id, { bodyHtml: "<p>Tuesday works.</p>" + d.bodyHtml });
    svc.sendDraft(USER, d.id, { delaySeconds: 0 });
    await deliverDraft(d.id);
    const raw = dev.outbox.at(-1)!.raw.toString();
    expect(raw).toMatch(/In-Reply-To: <m2@test.local>/i);
    expect(raw).toMatch(/References: <m1@test.local>/i);
    await syncAccountOnce(accountId);
    await syncAccountOnce(accountId);
    const th = svc.getThread(USER, t.threadId);
    expect(th.messages.length).toBe(3); // m1, m2, our reply (Sent) all in one thread
    expect(svc.listThreads(USER, { q: "kickoff" }).threads[0].answered).toBe(true);
  });

  it("downloads attachments from the server", async () => {
    const raw = Buffer.from(
      ["From: Bob <bob@test.local>", "To: alice@test.local", "Subject: With file", "Message-ID: <att1@test.local>", "MIME-Version: 1.0",
        'Content-Type: multipart/mixed; boundary="b1"', "", "--b1", "Content-Type: text/plain", "", "see attached", "--b1",
        'Content-Type: text/plain; name="notes.txt"', 'Content-Disposition: attachment; filename="notes.txt"', "Content-Transfer-Encoding: base64", "",
        Buffer.from("attachment-body-123").toString("base64"), "--b1--", ""].join("\r\n"),
    );
    await dev.deliverLocal("alice@test.local", raw);
    await syncAccountOnce(accountId);
    const t = svc.listThreads(USER, { q: "has:attachment" }).threads[0];
    expect(t.hasAttachments).toBe(true);
    const m = svc.getMessage(USER, t.id);
    expect(m.attachments[0]).toMatchObject({ filename: "notes.txt" });
    const a = await svc.getAttachmentContent(USER, m.attachments[0].id);
    expect(a.content.toString()).toBe("attachment-body-123");
  });
});

describe("isolation", () => {
  it("other users cannot see or touch this user's mail", () => {
    expect(svc.listThreads("someone-else", {}).threads).toHaveLength(0);
    const any = db().prepare("SELECT id FROM messages LIMIT 1").get() as { id: string };
    expect(() => svc.getMessage("someone-else", any.id)).toThrow(/not found/i);
    expect(() => svc.actOnThreads("someone-else", [any.id], { type: "trash" })).toThrow();
    expect(svc.listAccounts("someone-else")).toHaveLength(0);
  });
});

describe("account safety", () => {
  it("rejects link-local / metadata hosts", async () => {
    await expect(
      svc.addAccount(USER, {
        name: "x", email: "x@test.local", imapHost: "169.254.169.254", imapPort: 143, imapSecure: false, imapUser: "a", imapPass: "b",
        smtpHost: "127.0.0.1", smtpPort: 12025, smtpSecure: false, smtpUser: "a", smtpPass: "b", skipVerify: true,
      }),
    ).rejects.toThrow(/link-local/);
  });

  it("partial account updates do not reset untouched fields", async () => {
    const before = svc.listAccounts(USER)[0];
    const after = await svc.updateAccount(USER, before.id, { signature: "-- Alice" });
    expect(after.imapPort).toBe(before.imapPort);
    expect(after.imapSecure).toBe(before.imapSecure);
    expect(after.smtpPort).toBe(before.smtpPort);
    expect(after.signature).toBe("-- Alice");
  });

  it("scheduled send is held until its time", async () => {
    const d = svc.createDraft(USER, { to: [{ name: "", address: "bob@test.local" }], subject: "Later" });
    const at = Math.floor(Date.now() / 1000) + 3600;
    svc.sendDraft(USER, d.id, { at });
    expect(svc.getDraft(USER, d.id)).toMatchObject({ status: "scheduled", sendAt: at });
    const due = db().prepare("SELECT id FROM drafts WHERE status = 'scheduled' AND send_at <= unixepoch()").all();
    expect(due).toHaveLength(0);
  });
});

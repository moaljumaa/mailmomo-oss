import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import crypto from "node:crypto";
import fs from "node:fs";
import { accountPasswords, type AccountRow } from "./accounts";
import type { Addr } from "@/lib/types";

export type OutgoingMail = {
  from: Addr;
  to: Addr[];
  cc: Addr[];
  bcc: Addr[];
  subject: string;
  html: string;
  text: string;
  inReplyTo?: string | null;
  references?: string[];
  attachments?: { filename: string; contentType: string; path: string }[];
};

function transportFor(acc: AccountRow) {
  const pw = accountPasswords(acc);
  return nodemailer.createTransport({
    host: acc.smtp_host,
    port: acc.smtp_port,
    secure: !!acc.smtp_secure,
    // strict accounts must upgrade to TLS; "allow insecure" accounts (dev / LAN relays) may stay plain
    requireTLS: !acc.smtp_secure && !!acc.tls_reject_unauthorized,
    auth: acc.smtp_user ? { user: acc.smtp_user, pass: pw.smtp } : undefined,
    tls: { rejectUnauthorized: !!acc.tls_reject_unauthorized },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
  });
}

const fmt = (a: Addr) => ({ name: a.name, address: a.address });

export async function buildRaw(m: OutgoingMail): Promise<{ raw: Buffer; messageId: string }> {
  const domain = m.from.address.split("@")[1] || "localhost";
  const messageId = `<${crypto.randomUUID()}@${domain}>`;
  const composer = new MailComposer({
    from: fmt(m.from),
    to: m.to.map(fmt),
    cc: m.cc.map(fmt),
    bcc: m.bcc.map(fmt),
    subject: m.subject,
    html: m.html,
    text: m.text,
    messageId,
    inReplyTo: m.inReplyTo ? `<${m.inReplyTo}>` : undefined,
    references: m.references?.length ? m.references.map((r) => `<${r}>`) : undefined,
    attachments: m.attachments?.map((a) => ({ filename: a.filename, contentType: a.contentType, content: fs.createReadStream(a.path) })),
    headers: { "X-Mailer": "Mailmomo" },
  });
  const node = composer.compile();
  node.keepBcc = true; // keep Bcc in the stored Sent copy; stripped below for the wire
  const raw = await node.build();
  return { raw, messageId: messageId.replace(/^<|>$/g, "").toLowerCase() };
}

/** Strip Bcc header for the wire copy. */
export function stripBcc(raw: Buffer): Buffer {
  const s = raw.toString("binary");
  const idx = s.indexOf("\r\n\r\n");
  const head = s.slice(0, idx).replace(/^bcc:[^\r\n]*(\r\n[ \t][^\r\n]*)*\r\n/gim, "");
  const head2 = head.replace(/\r\nbcc:[^\r\n]*(\r\n[ \t][^\r\n]*)*/gi, "");
  return Buffer.from(head2 + s.slice(idx), "binary");
}

export async function deliver(acc: AccountRow, m: OutgoingMail): Promise<{ raw: Buffer; messageId: string; accepted: string[] }> {
  const { raw, messageId } = await buildRaw(m);
  const recipients = [...m.to, ...m.cc, ...m.bcc].map((a) => a.address);
  if (!recipients.length) throw new Error("No recipients");
  const t = transportFor(acc);
  try {
    const info = await t.sendMail({ envelope: { from: m.from.address, to: recipients }, raw: stripBcc(raw) });
    if (info.rejected?.length && !info.accepted?.length) throw new Error(`All recipients rejected: ${info.rejected.join(", ")}`);
    return { raw, messageId, accepted: info.accepted as string[] };
  } finally {
    t.close();
  }
}

export async function testSmtp(cfg: { host: string; port: number; secure: boolean; user: string; pass: string; rejectUnauthorized: boolean }) {
  const t = nodemailer.createTransport({
    host: cfg.host, port: cfg.port, secure: cfg.secure,
    requireTLS: !cfg.secure && cfg.rejectUnauthorized,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    tls: { rejectUnauthorized: cfg.rejectUnauthorized }, connectionTimeout: 15000, greetingTimeout: 15000,
  });
  try {
    await t.verify();
  } finally {
    t.close();
  }
}

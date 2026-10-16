#!/usr/bin/env node
// Local dev/test mail environment: a real Dovecot IMAP server + a tiny SMTP "MTA" that
// delivers incoming mail into recipients' INBOX (via IMAP APPEND). Used by tests, e2e and demos.
//   node scripts/devmail.mjs            # runs until killed
// Users: alice@test.local / bob@test.local / carol@test.local, password "pass".
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SMTPServer } from "smtp-server";
import { ImapFlow } from "imapflow";

export const IMAP_PORT = Number(process.env.DEV_IMAP_PORT || 11143);
export const SMTP_PORT = Number(process.env.DEV_SMTP_PORT || 11025);
export const USERS = ["alice", "bob", "carol"];

export async function startDevMail({ dir = fs.mkdtempSync(path.join(os.tmpdir(), "mmdev-")) } = {}) {
  fs.chmodSync(dir, 0o755);
  const run = path.join(dir, "run");
  const mail = path.join(dir, "mail");
  fs.mkdirSync(run, { recursive: true });
  fs.mkdirSync(mail, { recursive: true });
  fs.writeFileSync(path.join(dir, "users"), USERS.map((u) => `${u}@test.local:{PLAIN}pass`).join("\n") + "\n");
  const isRoot = (process.getuid?.() ?? 0) === 0;
  const uid = isRoot ? 1000 : process.getuid();
  const gid = isRoot ? 1000 : process.getgid();
  if (isRoot) fs.chownSync(mail, uid, gid);
  const dovecotBin = ["/usr/sbin/dovecot", "dovecot"].find((b) => b.startsWith("/") ? fs.existsSync(b) : true);
  const conf = `
protocols = imap
listen = 127.0.0.1
base_dir = ${run}
state_dir = ${run}
log_path = /dev/stderr
info_log_path = /dev/stderr
ssl = no
disable_plaintext_auth = no
auth_mechanisms = plain login
first_valid_uid = 1
mail_uid = ${uid}
mail_gid = ${gid}
mail_location = maildir:${mail}/%n
mail_privileged_group =
service imap-login {
  inet_listener imap {
    port = ${IMAP_PORT}
  }
  inet_listener imaps {
    port = 0
  }
}
service anvil {
  chroot =
}
service auth {
  unix_listener auth-userdb {
    mode = 0666
  }
}
passdb {
  driver = passwd-file
  args = scheme=PLAIN username_format=%u ${dir}/users
}
userdb {
  driver = static
  args = uid=${uid} gid=${gid} home=${mail}/%n
}
namespace inbox {
  inbox = yes
  mailbox Drafts {
    special_use = \\Drafts
    auto = subscribe
  }
  mailbox Sent {
    special_use = \\Sent
    auto = subscribe
  }
  mailbox Trash {
    special_use = \\Trash
    auto = subscribe
  }
  mailbox Junk {
    special_use = \\Junk
    auto = subscribe
  }
  mailbox Archive {
    special_use = \\Archive
    auto = subscribe
  }
}
`;
  fs.writeFileSync(path.join(dir, "dovecot.conf"), conf);
  const proc = spawn(dovecotBin, ["-F", "-c", path.join(dir, "dovecot.conf")], { stdio: ["ignore", "ignore", process.env.DEV_MAIL_DEBUG ? "inherit" : "ignore"] });
  // wait for IMAP
  for (let i = 0; i < 50; i++) {
    try {
      const c = new ImapFlow({ host: "127.0.0.1", port: IMAP_PORT, secure: false, auth: { user: "alice@test.local", pass: "pass" }, logger: false });
      c.on("error", () => {});
      await c.connect();
      await c.logout();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
      if (i === 49) throw new Error("dovecot did not start");
    }
  }

  const outbox = [];
  const smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    allowInsecureAuth: true,
    onAuth(auth, _s, cb) {
      if (auth.password === "pass") return cb(null, { user: auth.username });
      cb(new Error("Invalid credentials"));
    },
    async onData(stream, session, cb) {
      const chunks = [];
      for await (const c of stream) chunks.push(c);
      const raw = Buffer.concat(chunks);
      outbox.push({ from: session.envelope.mailFrom.address, to: session.envelope.rcptTo.map((r) => r.address), raw });
      for (const r of session.envelope.rcptTo) {
        const local = r.address.split("@")[0];
        if (!USERS.includes(local) || !r.address.endsWith("@test.local")) continue;
        await deliverLocal(r.address, raw);
      }
      cb();
    },
  });
  await new Promise((res) => smtp.listen(SMTP_PORT, "127.0.0.1", res));

  async function deliverLocal(address, raw, { mailbox = "INBOX", flags = [] } = {}) {
    const c = new ImapFlow({ host: "127.0.0.1", port: IMAP_PORT, secure: false, auth: { user: address, pass: "pass" }, logger: false });
    c.on("error", () => {});
    await c.connect();
    try {
      await c.append(mailbox, raw, flags);
    } finally {
      await c.logout();
    }
  }

  async function stop() {
    smtp.close();
    proc.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 300));
    try { proc.kill("SIGKILL"); } catch {}
  }
  return { dir, outbox, deliverLocal, stop, imapPort: IMAP_PORT, smtpPort: SMTP_PORT };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = await startDevMail();
  console.log(`dev mail up: IMAP 127.0.0.1:${env.imapPort}  SMTP 127.0.0.1:${env.smtpPort}  users ${USERS.map((u) => u + "@test.local").join(", ")} / pass`);
  const bye = async () => { await env.stop(); process.exit(0); };
  process.on("SIGINT", bye);
  process.on("SIGTERM", bye);
}

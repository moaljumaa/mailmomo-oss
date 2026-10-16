export const E2E = { imap: 21143, smtp: 21025 };

export default async function globalSetup() {
  process.env.DEV_IMAP_PORT = String(E2E.imap);
  process.env.DEV_SMTP_PORT = String(E2E.smtp);
  const { startDevMail } = await import("../scripts/devmail.mjs");
  const { eml } = await import("../tests/helpers");
  const dev = await startDevMail();
  (globalThis as unknown as { __dev: typeof dev }).__dev = dev;
  const hour = (h: number) => new Date(Date.now() - h * 3600_000).toUTCString();
  const to = "alice@test.local";
  const msgs = [
    eml({ from: "Bob Builder <bob@test.local>", to, subject: "Project kickoff", body: "Hi Alice,\n\nCan you send the budget please? We kick off on Tuesday.\n\nBob", messageId: "<k1@test.local>", date: hour(5) }),
    eml({ from: "Bob Builder <bob@test.local>", to, subject: "Re: Project kickoff", body: "Also: bring the pineapple pizza coupons.\n\nBob", messageId: "<k2@test.local>", inReplyTo: "<k1@test.local>", references: "<k1@test.local>", date: hour(4) }),
    eml({ from: "Shop <news@shop.example>", to, subject: "Weekly deals: 50% off", html: '<div style="font-family:Arial"><h2>Big <b>sale</b> this week</h2><p>Save 50% on everything.</p><img src="https://track.example/pixel.gif" width="1" height="1"></div>', headers: { "List-Unsubscribe": "<mailto:unsub@shop.example>, <https://shop.example/u/1>", "List-Id": "<deals.shop.example>" }, date: hour(3) }),
    eml({ from: "Stripe <noreply@stripe.com>", to, subject: "Your invoice from ACME", body: "Invoice #1234 for $99.00 is ready.", date: hour(2) }),
    eml({ from: "GitHub <notifications@github.com>", to, subject: "[repo] Pull request merged", body: "Your pull request was merged.", date: hour(30) }),
    eml({ from: "Carol <carol@test.local>", to, subject: "Lunch tomorrow?", body: "Are you free for lunch tomorrow? Please let me know.", date: hour(1) }),
  ];
  for (const m of msgs) await dev.deliverLocal(to, m);
  const att = Buffer.from(
    ["From: Dana <dana@client.example>", `To: ${to}`, "Subject: Signed contract", "Message-ID: <att1@test.local>", `Date: ${hour(0.5)}`, "MIME-Version: 1.0", 'Content-Type: multipart/mixed; boundary="b1"', "", "--b1", "Content-Type: text/plain", "", "Contract attached, thanks!", "--b1",
      'Content-Type: text/plain; name="contract.txt"', 'Content-Disposition: attachment; filename="contract.txt"', "Content-Transfer-Encoding: base64", "", Buffer.from("THE-CONTRACT-TEXT").toString("base64"), "--b1--", ""].join("\r\n"),
  );
  await dev.deliverLocal(to, att);
}

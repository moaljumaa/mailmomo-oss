export function eml(o: { from: string; to: string; subject: string; body?: string; html?: string; date?: string; messageId?: string; inReplyTo?: string; references?: string; headers?: Record<string, string>; cc?: string }) {
  const id = o.messageId ?? `<${Math.random().toString(36).slice(2)}@test.local>`;
  const lines = [
    `From: ${o.from}`,
    `To: ${o.to}`,
    ...(o.cc ? [`Cc: ${o.cc}`] : []),
    `Subject: ${o.subject}`,
    `Date: ${o.date ?? new Date().toUTCString()}`,
    `Message-ID: ${id}`,
    ...(o.inReplyTo ? [`In-Reply-To: ${o.inReplyTo}`] : []),
    ...(o.references ? [`References: ${o.references}`] : []),
    ...Object.entries(o.headers ?? {}).map(([k, v]) => `${k}: ${v}`),
    "MIME-Version: 1.0",
  ];
  if (o.html) {
    lines.push('Content-Type: text/html; charset="utf-8"', "", o.html);
  } else {
    lines.push('Content-Type: text/plain; charset="utf-8"', "", o.body ?? "hello");
  }
  return Buffer.from(lines.join("\r\n") + "\r\n");
}

import { describe, expect, it } from "vitest";
import { parseQuery, ftsExpr, buildSearchSql } from "@/server/mail/search";
import { normalizeSubject } from "@/server/mail/threading";
import { sanitizeEmailHtml, parseRaw } from "@/server/mail/parse";
import { encrypt, decrypt } from "@/server/crypto";
import { heuristicCategory } from "@/server/mail/heuristics";
import { matchCondition } from "@/server/mail/rules";
import { detectRole } from "@/server/mail/sync";
import { eml } from "./helpers";

describe("search parser", () => {
  it("parses operators, quotes and negation", () => {
    const q = parseQuery('from:aws subject:"your invoice" has:attachment is:unread label:work -from:spam hello world after:7d', Date.UTC(2026, 0, 15));
    expect(q.from).toEqual(["aws"]);
    expect(q.subject).toEqual(["your invoice"]);
    expect(q.hasAttachment).toBe(true);
    expect(q.unread).toBe(true);
    expect(q.label).toEqual(["work"]);
    expect(q.negated.from).toEqual(["spam"]);
    expect(q.text).toEqual(["hello", "world"]);
    expect(q.after).toBe(Math.floor(Date.UTC(2026, 0, 15) / 1000) - 7 * 86400);
  });
  it("builds safe FTS expressions", () => {
    expect(ftsExpr(['foo"bar', "a b"])).toBe('"foobar"* "a"* "b"*');
    expect(ftsExpr(["(){}"])).toBe("");
  });
  it("maps in: to folder roles", () => {
    expect(buildSearchSql(parseQuery("in:sent")).inRole).toBe("sent");
    expect(buildSearchSql(parseQuery("in:anywhere")).inRole).toBe("all");
  });
});

describe("threading helpers", () => {
  it("normalizes reply prefixes", () => {
    expect(normalizeSubject("Re: RE: Fwd: Hello World")).toBe("hello world");
    expect(normalizeSubject("AW: Re[2]: Hi")).toBe("hi");
  });
});

describe("html sanitizer", () => {
  it("removes scripts, handlers, forms and js urls", () => {
    const { html } = sanitizeEmailHtml('<div onclick="x()">hi<script>alert(1)</script><a href="javascript:alert(1)">x</a><form action="/x"><input></form><iframe src="//e"></iframe></div>');
    expect(html).not.toMatch(/script|onclick|javascript:|<form|<iframe|<input/i);
    expect(html).toContain("hi");
  });
  it("flags remote images and rewrites cid", () => {
    const r = sanitizeEmailHtml('<img src="https://t.example/pixel.gif"><img src="cid:logo1">', { logo1: "/api/attachments/x_0" });
    expect(r.remoteImages).toBe(true);
    expect(r.html).toContain('src="/api/attachments/x_0"');
  });
  it("forces safe link attributes", () => {
    const { html } = sanitizeEmailHtml('<a href="https://a.com">a</a>');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("noopener");
  });
});

describe("parse", () => {
  it("extracts headers, snippet, list-unsubscribe", async () => {
    const p = await parseRaw(eml({ from: "News <news@shop.com>", to: "me@x.com", subject: "Weekly", body: "Hello there https://x.y/z", headers: { "List-Unsubscribe": "<mailto:u@shop.com>" } }));
    expect(p.from).toEqual({ name: "News", address: "news@shop.com" });
    expect(p.listUnsubscribe).toContain("mailto");
    expect(p.snippet).toBe("Hello there");
  });
});

describe("crypto", () => {
  it("round-trips and uses random IVs", () => {
    const a = encrypt("secret"), b = encrypt("secret");
    expect(a).not.toEqual(b);
    expect(decrypt(a)).toBe("secret");
    expect(() => decrypt(a.slice(0, -4) + "AAAA")).toThrow();
  });
});

describe("heuristics + rules", () => {
  it("categorizes", () => {
    const base = { fromAddr: "a@b.com", subject: "hi", listUnsubscribe: null, hasListId: false, precedenceBulk: false, autoSubmitted: false };
    expect(heuristicCategory(base)).toBe("primary");
    expect(heuristicCategory({ ...base, listUnsubscribe: "<x>" })).toBe("newsletters");
    expect(heuristicCategory({ ...base, listUnsubscribe: "<x>", subject: "50% off sale" })).toBe("promotions");
    expect(heuristicCategory({ ...base, fromAddr: "noreply@stripe.com" })).toBe("updates");
    expect(heuristicCategory({ ...base, fromAddr: "notification@linkedin.com" })).toBe("social");
  });
  it("matches rule conditions", () => {
    const m = { from_name: "AWS", from_addr: "no-reply@aws.amazon.com", subject: "Your bill", to_json: "[]", cc_json: "[]", body_text: "x", snippet: "x", has_attachments: 1, category: "updates" } as never;
    expect(matchCondition({ field: "from", op: "contains", value: "aws" }, m, "me@x.com", false)).toBe(true);
    expect(matchCondition({ field: "subject", op: "not_contains", value: "invoice" }, m, "me@x.com", false)).toBe(true);
    expect(matchCondition({ field: "has_attachment", op: "is_true" }, m, "me@x.com", false)).toBe(true);
    expect(matchCondition({ field: "category", op: "equals", value: "updates" }, m, "me@x.com", false)).toBe(true);
  });
  it("detects folder roles", () => {
    expect(detectRole({ path: "INBOX", name: "INBOX" })).toBe("inbox");
    expect(detectRole({ path: "Sent Items", name: "Sent Items" })).toBe("sent");
    expect(detectRole({ path: "INBOX.Trash", name: "Trash" })).toBe("trash");
    expect(detectRole({ path: "X", name: "X", specialUse: "\\Archive" })).toBe("archive");
    expect(detectRole({ path: "Projects", name: "Projects" })).toBe(null);
  });
});

import { simpleParser, type ParsedMail, type AddressObject } from "mailparser";
import sanitizeHtml from "sanitize-html";
import type { Addr } from "@/lib/types";

export type ParsedAttachment = {
  filename: string;
  contentType: string;
  size: number;
  cid: string | null;
  inline: boolean;
  content?: Buffer;
};

export type Parsed = {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  subject: string;
  from: Addr;
  to: Addr[];
  cc: Addr[];
  replyTo: string | null;
  date: number;
  text: string;
  html: string | null; // sanitized
  snippet: string;
  attachments: ParsedAttachment[];
  listUnsubscribe: string | null;
  autoSubmitted: boolean;
  precedenceBulk: boolean;
  hasListId: boolean;
  hasRemoteImages: boolean;
};

function addrs(a: AddressObject | AddressObject[] | undefined): Addr[] {
  if (!a) return [];
  const list = Array.isArray(a) ? a : [a];
  return list
    .flatMap((x) => x.value)
    .filter((v) => v.address)
    .map((v) => ({ name: (v.name || "").trim(), address: v.address!.toLowerCase() }));
}

const ALLOWED_TAGS = [
  ...sanitizeHtml.defaults.allowedTags,
  "img", "center", "font", "style_", "h1", "h2", "span", "div", "table", "thead", "tbody", "tfoot", "tr", "td", "th",
  "caption", "colgroup", "col", "u", "s", "small", "sub", "sup", "hr", "figure", "figcaption", "details", "summary",
];

/** Sanitize untrusted email HTML. Scripts, forms, iframes, event handlers and unsafe URLs are dropped. */
export function sanitizeEmailHtml(html: string, cidMap: Record<string, string> = {}): { html: string; remoteImages: boolean } {
  let remoteImages = false;
  const out = sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      "*": ["style", "class", "align", "valign", "width", "height", "bgcolor", "border", "cellpadding", "cellspacing", "colspan", "rowspan", "dir", "lang", "title", "color", "face", "size"],
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "width", "height", "style", "align", "border"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "data", "cid"] },
    allowedStyles: {
      "*": {
        color: [/^[#\w(),.%\s-]+$/], "background-color": [/^[#\w(),.%\s-]+$/], background: [/^[#\w(),.%\s-]+$/],
        "text-align": [/^\w+$/], "font-size": [/^[\d.]+(px|pt|em|rem|%)$/], "font-weight": [/^\w+$/], "font-style": [/^\w+$/],
        "font-family": [/^[\w\s,'"-]+$/], "text-decoration": [/^[\w\s-]+$/], "line-height": [/^[\d.]+(px|pt|em|rem|%)?$/],
        margin: [/^[\d.\sauto%pxemrt-]+$/], padding: [/^[\d.\s%pxemrt-]+$/], "margin-top": [/^[\d.\sauto%pxemrt-]+$/], "margin-bottom": [/^[\d.\sauto%pxemrt-]+$/],
        "margin-left": [/^[\d.\sauto%pxemrt-]+$/], "margin-right": [/^[\d.\sauto%pxemrt-]+$/], "padding-top": [/^[\d.\s%pxemrt-]+$/],
        "padding-bottom": [/^[\d.\s%pxemrt-]+$/], "padding-left": [/^[\d.\s%pxemrt-]+$/], "padding-right": [/^[\d.\s%pxemrt-]+$/],
        width: [/^[\d.]+(px|%|em|rem)?$/], height: [/^[\d.]+(px|%|em|rem)?$/], "max-width": [/^[\d.]+(px|%|em|rem)$/], "min-width": [/^[\d.]+(px|%|em|rem)$/],
        border: [/^[\w#\s.(),%-]+$/], "border-radius": [/^[\d.\s%pxem]+$/], "border-collapse": [/^\w+$/], display: [/^(block|inline|inline-block|none|table|table-cell|table-row)$/],
        "vertical-align": [/^\w+$/], "white-space": [/^[\w-]+$/], "letter-spacing": [/^[\d.\-]+(px|em)$/],
      },
    },
    transformTags: {
      a: (tag, attribs) => ({ tagName: "a", attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer nofollow" } }),
      img: (tag, attribs) => {
        let src = attribs.src || "";
        if (src.toLowerCase().startsWith("cid:")) {
          const key = src.slice(4).replace(/^<|>$/g, "");
          src = cidMap[key] || "";
        } else if (/^https?:/i.test(src)) {
          remoteImages = true;
        }
        return { tagName: "img", attribs: { ...attribs, src } };
      },
    },
    disallowedTagsMode: "discard",
  });
  return { html: out, remoteImages };
}

export function htmlToText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {}, nonTextTags: ["style", "script", "textarea", "option", "head", "title"] })
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

export function makeSnippet(text: string, n = 180): string {
  return text.replace(/\s+/g, " ").replace(/https?:\/\/\S+/g, "").trim().slice(0, n);
}

function rawHeader(p: ParsedMail, name: string): string | null {
  const l = p.headerLines.find((x) => x.key === name);
  return l ? l.line.slice(l.line.indexOf(":") + 1).replace(/\r?\n\s+/g, " ").trim() : null;
}

function header(p: ParsedMail, name: string): string | null {
  if (name.startsWith("list-")) return rawHeader(p, name);
  const v = p.headers.get(name);
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const o = v as { text?: string; url?: string; mail?: string };
    if (o.text) return String(o.text);
    // mailparser decodes List-* headers into { url, mail }
    if (o.url || o.mail) return [o.mail ? `<mailto:${o.mail}>` : "", o.url ? `<${o.url}>` : ""].filter(Boolean).join(", ");
  }
  return String(v);
}

export function normalizeMessageId(id: string | null | undefined): string | null {
  if (!id) return null;
  const m = id.match(/<([^>]+)>/);
  return (m ? m[1] : id).trim().toLowerCase() || null;
}

/** Parse raw RFC822. `attIdMap` resolves cid → URL once attachment ids exist (applied later by ingest). */
export async function parseRaw(source: Buffer | string, cidResolver?: (cid: string, idx: number) => string): Promise<Parsed> {
  const p = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true });
  const from = addrs(p.from)[0] ?? { name: "", address: "" };
  const refsRaw = Array.isArray(p.references) ? p.references : p.references ? [p.references] : [];
  const references = refsRaw.map(normalizeMessageId).filter((x): x is string => !!x);

  const attachments: ParsedAttachment[] = p.attachments.map((a) => ({
    filename: a.filename || (a.contentType.startsWith("image/") ? "image" : "attachment"),
    contentType: a.contentType,
    size: a.size,
    cid: a.cid ? a.cid.replace(/^<|>$/g, "") : null,
    inline: a.contentDisposition === "inline" || (!!a.cid && a.related === true),
    content: a.content,
  }));

  const cidMap: Record<string, string> = {};
  attachments.forEach((a, i) => {
    if (a.cid && cidResolver) cidMap[a.cid] = cidResolver(a.cid, i);
  });

  let html: string | null = null;
  let remote = false;
  if (p.html) {
    const s = sanitizeEmailHtml(p.html, cidMap);
    html = s.html;
    remote = s.remoteImages;
  }
  const text = (p.text || (p.html ? htmlToText(p.html) : "")).trim();
  const unsub = header(p, "list-unsubscribe");
  const autoSub = (header(p, "auto-submitted") || "").toLowerCase();
  const prec = (header(p, "precedence") || "").toLowerCase();

  return {
    messageId: normalizeMessageId(p.messageId),
    inReplyTo: normalizeMessageId(typeof p.inReplyTo === "string" ? p.inReplyTo : null),
    references,
    subject: (p.subject || "").trim(),
    from,
    to: addrs(p.to),
    cc: addrs(p.cc),
    replyTo: addrs(p.replyTo)[0]?.address ?? null,
    date: Math.floor((p.date ?? new Date()).getTime() / 1000),
    text,
    html,
    snippet: makeSnippet(text),
    attachments,
    listUnsubscribe: unsub,
    autoSubmitted: !!autoSub && autoSub !== "no",
    precedenceBulk: ["bulk", "list", "junk"].includes(prec),
    hasListId: !!header(p, "list-id"),
    hasRemoteImages: remote,
  };
}

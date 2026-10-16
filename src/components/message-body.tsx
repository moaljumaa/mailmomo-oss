"use client";
import { useEffect, useMemo, useRef, useState } from "react";

const BASE_CSS = `
html,body{margin:0;padding:0;background:#fff;color:#1f1f1f}
body{font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif;word-wrap:break-word;overflow-wrap:anywhere;padding:2px 0}
img{max-width:100%;height:auto}
table{max-width:100%}
a{color:#2f6fed}
blockquote{margin:8px 0;padding-left:12px;border-left:2px solid #ddd;color:#666}
pre{white-space:pre-wrap}
.mm-sig{color:#777}
`;

/**
 * Renders sanitized email HTML in a script-less sandboxed iframe with a strict CSP.
 * Remote images are blocked unless the user opts in.
 */
export function HtmlBody({ html, allowImages, onHeight }: { html: string; allowImages: boolean; onHeight?: (h: number) => void }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(60);
  const doc = useMemo(() => {
    const img = allowImages ? "img-src data: https: http: 'self';" : "img-src data: 'self';";
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${img} style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'"><base target="_blank"><style>${BASE_CSS}</style></head><body>${html}</body></html>`;
  }, [html, allowImages]);

  useEffect(() => {
    const f = ref.current;
    if (!f) return;
    let ro: ResizeObserver | null = null;
    const measure = () => {
      const d = f.contentDocument;
      if (!d?.documentElement) return;
      const next = Math.max(40, d.documentElement.scrollHeight);
      setH(next);
      onHeight?.(next);
    };
    const onLoad = () => {
      measure();
      const d = f.contentDocument;
      if (d?.body) {
        ro = new ResizeObserver(measure);
        ro.observe(d.body);
        d.querySelectorAll("img").forEach((i) => i.addEventListener("load", measure));
      }
    };
    f.addEventListener("load", onLoad);
    if (f.contentDocument?.readyState === "complete") onLoad();
    return () => { f.removeEventListener("load", onLoad); ro?.disconnect(); };
  }, [doc, onHeight]);

  return (
    <iframe
      ref={ref}
      title="Message content"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      srcDoc={doc}
      className="w-full rounded-md border-0 bg-white"
      style={{ height: h, colorScheme: "light" }}
      data-testid="message-html"
    />
  );
}

const URL_RE = /(https?:\/\/[^\s<>"')]+[^\s<>"').,;:!?])/g;

export function TextBody({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <div className="whitespace-pre-wrap break-words text-[14px] leading-[1.6]" data-testid="message-text">
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline-offset-2 hover:underline">{p}</a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </div>
  );
}

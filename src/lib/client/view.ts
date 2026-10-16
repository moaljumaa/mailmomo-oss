"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import type { Category, ListQuery } from "@/lib/types";

export type ViewKind = "inbox" | "starred" | "snoozed" | "drafts" | "sent" | "archive" | "trash" | "spam" | "all" | "needs-reply" | "label" | "search" | "folder";

export type View = {
  kind: ViewKind;
  slug: string; // path part after /mail/
  title: string;
  accountId?: string;
  category: Category | "all";
  label?: string;
  q?: string;
  folderId?: string;
  threadId?: string;
  query: ListQuery;
};

const TITLES: Record<string, string> = {
  inbox: "Inbox", starred: "Starred", snoozed: "Snoozed", drafts: "Drafts", sent: "Sent", archive: "Archive", trash: "Trash", spam: "Spam", all: "All mail", "needs-reply": "Needs reply",
};

export function parseView(pathname: string, sp: URLSearchParams): View {
  const parts = pathname.replace(/^\/mail\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const first = parts[0] || "inbox";
  const accountId = sp.get("acct") || undefined;
  const category = (sp.get("cat") as Category | null) || "all";
  const threadId = sp.get("t") || undefined;
  let kind: ViewKind = (first in TITLES ? first : "folder") as ViewKind;
  let label: string | undefined, q: string | undefined, folderId: string | undefined;
  let title = TITLES[first] ?? first;
  if (first === "label") { kind = "label"; label = parts[1]; title = label ?? "Label"; }
  else if (first === "search") { kind = "search"; q = sp.get("q") || ""; title = "Search"; }
  else if (first === "f") { kind = "folder"; folderId = parts[1]; title = sp.get("name") || "Folder"; }
  const query: ListQuery = { accountId, limit: 40 };
  switch (kind) {
    case "inbox": query.folder = "inbox"; query.category = category; break;
    case "starred": query.starred = true; break;
    case "snoozed": query.snoozed = true; break;
    case "needs-reply": query.needsReply = true; query.folder = "inbox"; break;
    case "sent": query.folder = "sent"; break;
    case "drafts": query.folder = "drafts"; break;
    case "archive": query.folder = "archive"; break;
    case "trash": query.folder = "trash"; break;
    case "spam": query.folder = "junk"; break;
    case "all": query.folder = "all"; break;
    case "label": query.label = label; break;
    case "search": query.q = q; break;
    case "folder": query.folder = folderId; break;
  }
  return { kind, slug: parts.join("/"), title, accountId, category, label, q, folderId, threadId, query };
}

export function useView() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const router = useRouter();
  const view = useMemo(() => parseView(pathname, new URLSearchParams(sp.toString())), [pathname, sp]);

  const href = useCallback((path: string, params: Record<string, string | undefined> = {}) => {
    const p = new URLSearchParams();
    const keep = ["acct"];
    for (const k of keep) { const v = params[k] !== undefined ? params[k] : sp.get(k) ?? undefined; if (v) p.set(k, v); }
    for (const [k, v] of Object.entries(params)) if (!keep.includes(k) && v) p.set(k, v);
    const s = p.toString();
    return `/mail/${path}${s ? `?${s}` : ""}`;
  }, [sp]);

  const go = useCallback((path: string, params?: Record<string, string | undefined>) => router.push(href(path, params), { scroll: false }), [router, href]);
  /** Thread selection is pure client state: use the History API (Next syncs it into useSearchParams) so j/k is instant. */
  const openThread = useCallback((id: string | undefined, replace = true) => {
    const p = new URLSearchParams(window.location.search);
    if (id) p.set("t", id); else p.delete("t");
    const url = `${window.location.pathname}${p.toString() ? `?${p}` : ""}`;
    if (replace) window.history.replaceState(null, "", url); else window.history.pushState(null, "", url);
  }, []);
  const setParam = useCallback((k: string, v: string | undefined) => {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set(k, v); else p.delete(k);
    p.delete("t");
    router.push(`${pathname}${p.toString() ? `?${p}` : ""}`, { scroll: false });
  }, [router, pathname, sp]);

  return { view, go, href, openThread, setParam, router };
}

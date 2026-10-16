"use client";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api, qs } from "./api";
import { useUI } from "./store";
import type { AccountDTO, DraftDTO, FolderDTO, LabelDTO, ListQuery, RuleDTO, ServerEvent, Settings, ThreadDTO, ThreadSummary } from "@/lib/types";

type ThreadPage = { threads: ThreadSummary[]; hasMore: boolean };

export const keys = {
  threads: (q: ListQuery) => ["threads", q] as const,
  thread: (id: string) => ["thread", id] as const,
  folders: ["folders"] as const,
  counts: (acct?: string) => ["counts", acct ?? "all"] as const,
  accounts: ["accounts"] as const,
  labels: ["labels"] as const,
  settings: ["settings"] as const,
  drafts: ["drafts"] as const,
  rules: ["rules"] as const,
};

export const useAccounts = () => useQuery({ queryKey: keys.accounts, queryFn: () => api<AccountDTO[]>("/accounts"), staleTime: 30_000 });
export const useFolders = () => useQuery({ queryKey: keys.folders, queryFn: () => api<FolderDTO[]>("/folders"), staleTime: 10_000 });
export const useCounts = (acct?: string) => useQuery({ queryKey: keys.counts(acct), queryFn: () => api<{ unread: number; byCategory: Record<string, number>; needsReply: number; snoozed: number }>(`/counts${qs({ accountId: acct })}`), staleTime: 10_000 });
export const useLabels = () => useQuery({ queryKey: keys.labels, queryFn: () => api<(LabelDTO & { count: number })[]>("/labels"), staleTime: 30_000 });
export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: () => api<Settings & { _ai: boolean }>("/settings"), staleTime: 5_000, refetchOnMount: "always" });
export const useDrafts = () => useQuery({ queryKey: keys.drafts, queryFn: () => api<DraftDTO[]>("/drafts"), staleTime: 5_000 });
export const useRules = () => useQuery({ queryKey: keys.rules, queryFn: () => api<RuleDTO[]>("/rules") });

export function useThreads(q: ListQuery, enabled = true) {
  return useInfiniteQuery({
    queryKey: keys.threads(q),
    enabled,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => api<ThreadPage>(`/threads${qs({ ...q, offset: pageParam as number })}`, { signal }),
    getNextPageParam: (last, all) => (last.hasMore ? all.reduce((n, p) => n + p.threads.length, 0) : undefined),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
}

export const useThread = (id: string | undefined) =>
  useQuery({ queryKey: keys.thread(id ?? ""), enabled: !!id, queryFn: () => api<ThreadDTO>(`/threads/${id}`), staleTime: 30_000 });

export function prefetchThread(qc: QueryClient, id: string) {
  void qc.prefetchQuery({ queryKey: keys.thread(id), queryFn: () => api<ThreadDTO>(`/threads/${id}`), staleTime: 30_000 });
}

/** Live updates: the server pushes events; we invalidate the affected caches. */
export function useServerEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = new Set<string>();
    const flush = () => {
      timer = undefined;
      if (pending.has("mail")) {
        void qc.invalidateQueries({ queryKey: ["threads"] });
        void qc.invalidateQueries({ queryKey: ["folders"] });
        void qc.invalidateQueries({ queryKey: ["counts"] });
        void qc.invalidateQueries({ queryKey: ["thread"] });
        void qc.invalidateQueries({ queryKey: keys.labels });
      }
      if (pending.has("sync")) void qc.invalidateQueries({ queryKey: keys.accounts });
      if (pending.has("drafts")) void qc.invalidateQueries({ queryKey: keys.drafts });
      pending.clear();
    };
    const schedule = (k: string) => { pending.add(k); timer ??= setTimeout(flush, 250); };
    const connect = () => {
      es = new EventSource("/api/events");
      es.onmessage = (m) => {
        try {
          const e = JSON.parse(m.data) as ServerEvent | { type: "hello" };
          if (e.type === "mail" || e.type === "ai") schedule("mail");
          if (e.type === "sync") schedule("sync");
          if (e.type === "sent") {
            schedule("drafts");
            schedule("mail");
            if (!e.ok) useUI.getState().toast({ text: `Couldn't send: ${e.error}`, kind: "error", ttl: 8000 });
          }
        } catch {}
      };
      es.onerror = () => {
        es?.close();
        if (!closed) setTimeout(connect, 3000);
      };
    };
    connect();
    const onVis = () => { if (document.visibilityState === "visible") schedule("mail"); };
    document.addEventListener("visibilitychange", onVis);
    return () => { closed = true; es?.close(); document.removeEventListener("visibilitychange", onVis); if (timer) clearTimeout(timer); };
  }, [qc]);
}

/* -------------------------------- actions with optimistic updates -------------------------------- */

export type ActionSpec =
  | { type: "read" | "unread" | "star" | "unstar" | "archive" | "trash" | "spam" | "inbox" | "delete_forever" }
  | { type: "move"; folder: string }
  | { type: "snooze"; until: number | string | null }
  | { type: "label" | "unlabel"; name: string };

const REMOVES: ActionSpec["type"][] = ["archive", "trash", "spam", "snooze", "move", "delete_forever"];
const LABELS: Record<string, string> = { archive: "Archived", trash: "Moved to trash", spam: "Marked as spam", snooze: "Snoozed", read: "Marked read", unread: "Marked unread", star: "Starred", unstar: "Unstarred", inbox: "Moved to inbox", move: "Moved", label: "Labeled", unlabel: "Label removed", delete_forever: "Deleted" };
const UNDO: Partial<Record<ActionSpec["type"], (a: ActionSpec) => ActionSpec | null>> = {
  archive: () => ({ type: "inbox" }), trash: () => ({ type: "inbox" }), spam: () => ({ type: "inbox" }),
  snooze: () => ({ type: "snooze", until: null }), read: () => ({ type: "unread" }), unread: () => ({ type: "read" }),
  star: () => ({ type: "unstar" }), unstar: () => ({ type: "star" }),
  label: (a) => (a.type === "label" ? { type: "unlabel", name: a.name } : null), unlabel: (a) => (a.type === "unlabel" ? { type: "label", name: a.name } : null),
};

function patchLists(qc: QueryClient, ids: Set<string>, action: ActionSpec) {
  qc.setQueriesData<InfiniteData<ThreadPage>>({ queryKey: ["threads"] }, (old) => {
    if (!old) return old;
    return {
      ...old,
      pages: old.pages.map((p) => ({
        ...p,
        threads: p.threads.flatMap((t) => {
          if (!ids.has(t.threadId) && !ids.has(t.id)) return [t];
          if (REMOVES.includes(action.type)) return [];
          switch (action.type) {
            case "read": return [{ ...t, seen: true, unreadCount: 0 }];
            case "unread": return [{ ...t, seen: false, unreadCount: Math.max(1, t.unreadCount) }];
            case "star": return [{ ...t, flagged: true }];
            case "unstar": return [{ ...t, flagged: false }];
            case "label": return [{ ...t, labels: t.labels.some((l) => l.name.toLowerCase() === action.name.toLowerCase()) ? t.labels : [...t.labels, { id: "tmp", name: action.name, color: "#94a3b8" }] }];
            case "unlabel": return [{ ...t, labels: t.labels.filter((l) => l.name.toLowerCase() !== action.name.toLowerCase()) }];
            default: return [t];
          }
        }),
      })),
    };
  });
}

export function useThreadActions() {
  const qc = useQueryClient();
  const toast = useUI((s) => s.toast);

  const mutation = useMutation({
    mutationFn: (v: { ids: string[]; action: ActionSpec; folderId?: string }) => api<{ affected: number }>("/actions", { body: { ids: v.ids, action: v.action, folderId: v.folderId } }),
  });

  const run = async (ids: string[], action: ActionSpec, opts: { silent?: boolean; folderId?: string; label?: string; isUndo?: boolean } = {}) => {
    if (!ids.length) return;
    const set = new Set(ids);
    await qc.cancelQueries({ queryKey: ["threads"] });
    const snapshot = qc.getQueriesData<InfiniteData<ThreadPage>>({ queryKey: ["threads"] });
    patchLists(qc, set, action);
    try {
      await mutation.mutateAsync({ ids, action, folderId: opts.folderId });
    } catch (e) {
      for (const [k, d] of snapshot) qc.setQueryData(k, d);
      toast({ text: (e as Error).message, kind: "error" });
      return;
    } finally {
      void qc.invalidateQueries({ queryKey: ["threads"] });
      void qc.invalidateQueries({ queryKey: ["folders"] });
      void qc.invalidateQueries({ queryKey: ["counts"] });
      for (const id of ids) void qc.invalidateQueries({ queryKey: keys.thread(id) });
      void qc.invalidateQueries({ queryKey: keys.labels });
    }
    if (!opts.silent) {
      const inverse = UNDO[action.type]?.(action) ?? null;
      const n = ids.length;
      toast({
        text: `${opts.label ?? LABELS[action.type] ?? "Done"}${n > 1 ? ` · ${n} conversations` : ""}`,
        undo: inverse && !opts.isUndo ? () => void run(ids, inverse, { isUndo: true, label: "Undone", folderId: opts.folderId }) : undefined,
      });
    }
  };
  return { run, pending: mutation.isPending };
}

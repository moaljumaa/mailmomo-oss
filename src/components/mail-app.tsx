"use client";
import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { keys, useAccounts, useCounts, useServerEvents, useThreadActions } from "@/lib/client/queries";
import { useUI } from "@/lib/client/store";
import { useView } from "@/lib/client/view";
import type { ThreadDTO } from "@/lib/types";
import { cx } from "./ui";
import { Sidebar } from "./sidebar";
import { ThreadList, useFlatThreads } from "./thread-list";
import { Reader } from "./reader";
import { ComposeLayer } from "./compose";
import { Palette } from "./palette";
import { Pickers } from "./pickers";
import { SearchBar } from "./search-bar";
import { AgentPanel } from "./agent-panel";
import { CleanupModal, HelpModal } from "./help-and-cleanup";
import { ThemeSync } from "./theme-sync";
import { AccountForm } from "./account-form";
import { openNewCompose, openReply } from "./compose-actions";

/** Next's metadata layer resets <title> after hydration; re-apply ours whenever it changes. */
function useDocumentTitle(title: string) {
  useEffect(() => {
    const apply = () => { if (document.title !== title) document.title = title; };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [title]);
}

function isEditable(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

export function MailApp() {
  const { view, openThread, go } = useView();
  const flat = useFlatThreads();
  const accounts = useAccounts();
  const qc = useQueryClient();
  const { run } = useThreadActions();
  const sidebarOpen = useUI((s) => s.sidebarOpen);
  const mobileNav = useUI((s) => s.mobileNav);
  const counts = useCounts(view.accountId);
  useServerEvents();
  useDocumentTitle(`${counts.data?.unread ? `(${counts.data.unread}) ` : ""}${view.title} · Mailmomo`);

  // close the mobile drawer whenever navigation happens
  useEffect(() => { useUI.getState().setMobileNav(false); }, [view.slug, view.accountId]);

  const threadsRef = useRef(flat.threads);
  threadsRef.current = flat.threads;
  const viewRef = useRef(view);
  viewRef.current = view;
  const cursorRef = useRef<string | undefined>(view.threadId);
  useEffect(() => { cursorRef.current = view.threadId; }, [view.threadId]);
  const gPending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const move = useCallback((delta: number) => {
    const list = threadsRef.current;
    if (!list.length) return;
    const cur = list.findIndex((t) => t.threadId === cursorRef.current);
    const next = cur === -1 ? (delta > 0 ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, cur + delta));
    cursorRef.current = list[next].threadId; // update synchronously so rapid key repeats don't read a stale URL
    openThread(list[next].threadId);
  }, [openThread]);

  /** After removing the active thread from the list, open its neighbour (Superhuman-style). */
  const advance = useCallback(() => {
    const list = threadsRef.current;
    const cur = list.findIndex((t) => t.threadId === cursorRef.current);
    if (cur === -1) return;
    const next = list[cur + 1] ?? list[cur - 1];
    cursorRef.current = next?.threadId;
    openThread(next?.threadId);
  }, [openThread]);

  const lastMessageId = useCallback((threadId: string) => {
    const cached = qc.getQueryData<ThreadDTO>(keys.thread(threadId));
    return cached?.messages.at(-1)?.id ?? threadsRef.current.find((t) => t.threadId === threadId)?.id;
  }, [qc]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const ui = useUI.getState();
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") { e.preventDefault(); ui.setPalette(!ui.paletteOpen); return; }
      if (meta && e.key.toLowerCase() === "j") { e.preventDefault(); ui.setAgent(!ui.agentOpen); return; }
      if (e.key === "Escape") {
        if (ui.searchOpen) { ui.setSearch(false); return; }
        if (ui.agentOpen && !isEditable(e.target)) { ui.setAgent(false); return; }
        if (!isEditable(e.target)) {
          if (ui.selected.length) { ui.setSelected([]); return; }
          if (cursorRef.current || viewRef.current.threadId) { cursorRef.current = undefined; openThread(undefined); return; }
        }
        return;
      }
      if (isEditable(e.target) || meta || e.altKey) return;
      if (ui.paletteOpen || ui.picker || ui.helpOpen || ui.cleanupOpen) return;
      const v = viewRef.current;
      const key = e.key;

      if (gPending.current) {
        clearTimeout(gPending.current); gPending.current = undefined;
        const map: Record<string, string> = { i: "inbox", s: "sent", d: "drafts", t: "trash", a: "archive", k: "starred", h: "snoozed", n: "needs-reply" };
        if (map[key]) { e.preventDefault(); go(map[key]); }
        return;
      }
      const active = cursorRef.current ?? v.threadId;
      const targets = ui.selected.length ? ui.selected : active ? [active] : [];
      const act = (type: Parameters<typeof run>[1], opts?: Parameters<typeof run>[2]) => {
        if (!targets.length) return;
        const usingSel = ui.selected.length > 0;
        if (!usingSel) advance();
        void run(targets, type, opts);
        if (usingSel) ui.setSelected([]);
      };
      switch (key) {
        case "g": gPending.current = setTimeout(() => { gPending.current = undefined; }, 900); break;
        case "j": case "ArrowDown": e.preventDefault(); move(1); break;
        case "k": case "ArrowUp": e.preventDefault(); move(-1); break;
        case "Enter": case "o": if (!active && threadsRef.current[0]) openThread(threadsRef.current[0].threadId); break;
        case "e": act({ type: "archive" }); break;
        case "#": case "Delete": act({ type: "trash" }); break;
        case "!": act({ type: "spam" }); break;
        case "s": { if (!targets.length) break; const t = threadsRef.current.find((x) => x.threadId === targets[0]); void run(targets, { type: t?.flagged ? "unstar" : "star" }); break; }
        case "u": { if (!targets.length) break; const t = threadsRef.current.find((x) => x.threadId === targets[0]); void run(targets, { type: t && !t.seen ? "read" : "unread" }, { silent: true }); break; }
        case "h": if (targets.length) { e.preventDefault(); ui.setPicker({ kind: "snooze", ids: targets }); } break;
        case "l": if (targets.length) { e.preventDefault(); ui.setPicker({ kind: "label", ids: targets }); } break;
        case "v": if (targets.length) { e.preventDefault(); ui.setPicker({ kind: "move", ids: targets }); } break;
        case "x": if (active) ui.toggleSelected(active); break;
        case "r": case "a": case "f": if (active) { const id = lastMessageId(active); if (id) { e.preventDefault(); void openReply(id, key === "r" ? "reply" : key === "a" ? "reply_all" : "forward"); } } break;
        case "c": e.preventDefault(); void openNewCompose(); break;
        case "/": e.preventDefault(); ui.setSearch(true); break;
        case "?": e.preventDefault(); ui.setHelp(true); break;
        case "[": ui.setSidebar(!ui.sidebarOpen); break;
        case "z": { const t = [...ui.toasts].reverse().find((x) => x.undo); if (t) { t.undo?.(); ui.dismissToast(t.id); } break; }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [advance, move, go, openThread, run, lastMessageId]);

  const hasAccounts = (accounts.data?.length ?? 0) > 0;
  const noAccounts = accounts.isSuccess && !hasAccounts;
  const open = !!view.threadId;
  const activeId = view.threadId;

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-bg" data-testid="mail-app">
      <ThemeSync />
      {sidebarOpen && !noAccounts && <div className={cx("h-full", open ? "hidden lg:block" : "hidden md:block")}><Sidebar /></div>}
      {noAccounts ? (
        <Onboarding />
      ) : (
        <>
          <div className={cx("relative flex h-full min-w-0 shrink-0 flex-col border-r border-line", open ? "hidden md:flex md:w-[380px] lg:w-[420px]" : "w-full md:w-[420px]")}>
            <ThreadList onOpen={(id) => { cursorRef.current = id; openThread(id); }} />
            <SearchBar />
          </div>
          <div className={cx("h-full min-w-0 flex-1", open ? "flex" : "hidden md:flex")}>
            <Reader threadId={activeId} onBack={() => openThread(undefined)} onAfterAction={() => advance()} />
          </div>
        </>
      )}
      {mobileNav && !noAccounts && (
        <div className="fixed inset-0 z-[70] md:hidden" onClick={() => useUI.getState().setMobileNav(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative h-full w-[260px] anim-fade" onClick={(e) => e.stopPropagation()}><Sidebar /></div>
        </div>
      )}
      <ComposeLayer />
      <Palette activeId={activeId} lastMessageId={activeId ? lastMessageId(activeId) : undefined} />
      <Pickers />
      <AgentPanel />
      <HelpModal />
      <CleanupModal />
    </div>
  );
}

function Onboarding() {
  return (
    <div className="flex h-full flex-1 items-start justify-center overflow-y-auto px-4 py-12" data-testid="onboarding">
      <div className="w-full max-w-[560px] anim-fade">
        <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-white"><Mail size={22} /></div>
        <h1 className="mb-1 text-[22px] font-semibold tracking-[-0.01em]">Connect your mailbox</h1>
        <p className="mb-6 text-[14px] text-muted">Mailmomo talks to your own IMAP server and sends through your SMTP (like AWS SES). Credentials are encrypted on this server and never sent to your browser.</p>
        <AccountForm />
      </div>
    </div>
  );
}

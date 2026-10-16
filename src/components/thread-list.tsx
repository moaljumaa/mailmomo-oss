"use client";
import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, Check, Clock, Menu as MenuIcon, MailOpen, Mail, Paperclip, PanelLeft, Search, Sparkles, Star, Trash2, CheckCircle2, Inbox as InboxIcon, Reply } from "lucide-react";
import { prefetchThread, useAccounts, useCounts, useDrafts, useSettings, useThreadActions, useThreads } from "@/lib/client/queries";
import { useView } from "@/lib/client/view";
import { useUI } from "@/lib/client/store";
import { displayName, shortTime, untilLabel } from "@/lib/client/format";
import { CATEGORIES, type ThreadSummary } from "@/lib/types";
import { cx, Empty, IconButton, Kbd, Spinner } from "./ui";
import { DraftsList } from "./drafts-list";

const CAT_LABEL: Record<string, string> = { all: "All", primary: "Primary", updates: "Updates", newsletters: "News", promotions: "Promos", social: "Social" };

export function dayBucket(unix: number): string {
  const d = new Date(unix * 1000);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= start) return "Today";
  if (t >= start - 86400_000) return "Yesterday";
  if (t >= start - 6 * 86400_000) return "This week";
  if (t >= start - 30 * 86400_000) return "This month";
  return "Earlier";
}

export function useFlatThreads() {
  const { view } = useView();
  const q = useThreads(view.query, view.kind !== "drafts");
  const threads = useMemo(() => q.data?.pages.flatMap((p) => p.threads) ?? [], [q.data]);
  return { ...q, threads };
}

function Row({ t, selected, checked, onOpen, onCheck, compact, showAcct }: { t: ThreadSummary; selected: boolean; checked: boolean; onOpen: () => void; onCheck: () => void; compact: boolean; showAcct?: string }) {
  const { run } = useThreadActions();
  const qc = useQueryClient();
  const unread = !t.seen;
  const people = t.participants.length ? t.participants : [displayName(t.fromName, t.fromAddr)];
  const who = t.count > 1 ? people.map((p) => p.split(" ")[0]).join(", ") : displayName(t.fromName, t.fromAddr);
  const preview = t.summary || t.snippet;
  return (
    <div
      role="option"
      aria-selected={selected}
      data-thread-id={t.threadId}
      data-testid="thread-row"
      onMouseEnter={() => prefetchThread(qc, t.threadId)}
      onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) onCheck(); else onOpen(); }}
      className={cx("group relative cursor-default select-none border-b border-line/60 px-4 transition-colors", compact ? "py-1.5" : "py-2.5", selected ? "bg-accent-soft" : checked ? "bg-selection" : "hover:bg-hover")}
      style={checked ? { background: "var(--selection)" } : undefined}
    >
      {selected && <span className="absolute inset-y-0 left-0 w-[2px] bg-accent" />}
      <div className="flex items-baseline gap-2">
        <button aria-label={checked ? "Deselect" : "Select"} onClick={(e) => { e.stopPropagation(); onCheck(); }} className={cx("mt-0.5 flex h-[15px] w-[15px] shrink-0 items-center justify-center self-center rounded-[4px] border transition-opacity", checked ? "border-accent bg-accent text-white opacity-100" : "border-faint/60 opacity-0 group-hover:opacity-100")}>
          {checked && <Check size={11} strokeWidth={3} />}
        </button>
        {!checked && unread && <span className="absolute left-1.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-accent group-hover:hidden" aria-label="Unread" />}
        <span className={cx("min-w-0 flex-1 truncate text-[13.5px]", unread ? "font-semibold text-fg" : "text-fg/80")}>{who}{t.count > 1 && <span className="ml-1.5 text-[11.5px] font-normal text-faint">{t.count}</span>}</span>
        {t.priority === 3 && <span title="High priority" className="text-[11px] text-danger">●</span>}
        {t.needsReply && <Reply size={12} className="shrink-0 text-ai" aria-label="Needs reply" />}
        {t.hasAttachments && <Paperclip size={12} className="shrink-0 text-faint" />}
        {t.flagged && <Star size={12} className="shrink-0 fill-[#e8a838] text-[#e8a838]" />}
        <span className={cx("shrink-0 text-[11.5px] tabular-nums", unread ? "font-medium text-fg" : "text-faint")}>{t.snoozedUntil ? <span className="inline-flex items-center gap-1 text-accent"><Clock size={11} />{untilLabel(t.snoozedUntil)}</span> : shortTime(t.date)}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 pl-[23px]">
        <span className={cx("truncate text-[13px]", unread ? "font-medium text-fg" : "text-muted")}>{t.subject || "(no subject)"}</span>
        {!compact && preview && (
          <span className="min-w-0 flex-1 truncate text-[13px] text-faint">
            {t.summary && <Sparkles size={10} className="mr-1 inline -translate-y-px text-ai" />}
            {t.summary ? "" : "— "}{preview}
          </span>
        )}
      </div>
      {(t.labels.length > 0 || showAcct) && !compact && (
        <div className="mt-1 flex flex-wrap gap-1 pl-[23px]">
          {showAcct && <span className="inline-flex items-center gap-1 rounded px-1.5 text-[11px] text-muted"><span className="h-1.5 w-1.5 rounded-full" style={{ background: showAcct }} /></span>}
          {t.labels.slice(0, 3).map((l) => <span key={l.id + l.name} className="rounded px-1.5 py-px text-[11px]" style={{ background: `color-mix(in srgb, ${l.color} 16%, transparent)`, color: `color-mix(in srgb, ${l.color} 70%, var(--fg))` }}>{l.name}</span>)}
        </div>
      )}
      <div className="absolute right-2 top-1.5 hidden items-center gap-0.5 rounded-md border border-line bg-raised p-0.5 shadow-sm group-hover:flex">
        <IconButton label="Archive" hint="e" onClick={(e) => { e.stopPropagation(); void run([t.threadId], { type: "archive" }); }}><Archive size={14} /></IconButton>
        <IconButton label="Snooze" hint="h" onClick={(e) => { e.stopPropagation(); useUI.getState().setPicker({ kind: "snooze", ids: [t.threadId] }); }}><Clock size={14} /></IconButton>
        <IconButton label={unread ? "Mark read" : "Mark unread"} hint="u" onClick={(e) => { e.stopPropagation(); void run([t.threadId], { type: unread ? "read" : "unread" }); }}>{unread ? <MailOpen size={14} /> : <Mail size={14} />}</IconButton>
        <IconButton label="Trash" hint="#" onClick={(e) => { e.stopPropagation(); void run([t.threadId], { type: "trash" }); }}><Trash2 size={14} /></IconButton>
      </div>
    </div>
  );
}

export function ThreadList({ onOpen }: { onOpen: (id: string) => void }) {
  const { view, setParam } = useView();
  const { threads, isLoading, isFetching, hasNextPage, fetchNextPage, isFetchingNextPage, error } = useFlatThreads();
  const counts = useCounts(view.accountId);
  const settings = useSettings();
  const drafts = useDrafts();
  const selected = useUI((s) => s.selected);
  const toggleSelected = useUI((s) => s.toggleSelected);
  const setSelected = useUI((s) => s.setSelected);
  const sidebarOpen = useUI((s) => s.sidebarOpen);
  const setSidebar = useUI((s) => s.setSidebar);
  const { run } = useThreadActions();
  const sentinel = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const compact = settings.data?.density === "compact";

  useEffect(() => {
    if (!sentinel.current || !hasNextPage) return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting && !isFetchingNextPage) void fetchNextPage(); }, { root: scroller.current, rootMargin: "400px" });
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, [hasNextPage, fetchNextPage, isFetchingNextPage, threads.length]);

  // keep the active row in view when navigating with the keyboard
  useEffect(() => {
    if (!view.threadId) return;
    scroller.current?.querySelector<HTMLElement>(`[data-thread-id="${CSS.escape(view.threadId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [view.threadId]);

  const tabs = settings.data?.splitTabs ?? [...CATEGORIES];
  const buckets = useMemo(() => {
    const out: { label: string; items: ThreadSummary[] }[] = [];
    for (const t of threads) {
      const b = view.kind === "snoozed" ? "Snoozed" : dayBucket(t.date);
      const last = out[out.length - 1];
      if (last && last.label === b) last.items.push(t);
      else out.push({ label: b, items: [t] });
    }
    return out;
  }, [threads, view.kind]);

  const hasSel = selected.length > 0;
  const accts = useAccounts().data;
  const initialSync = !!accts?.some((a) => (a.syncState === "syncing" || !a.lastSyncedAt) && a.syncState !== "error");
  const accountColor = (id: string) => (accts && accts.length > 1 ? accts.find((a) => a.id === id)?.color : undefined);

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-bg" aria-label="Conversations">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        <IconButton label="Menu" className="md:hidden" onClick={() => useUI.getState().setMobileNav(true)}><MenuIcon size={17} /></IconButton>
        {!sidebarOpen && <IconButton label="Show sidebar" hint="[" onClick={() => setSidebar(true)} className="hidden md:inline-flex"><PanelLeft size={16} /></IconButton>}
        {hasSel ? (
          <>
            <button className="text-[13px] font-medium" onClick={() => setSelected([])}>{selected.length} selected</button>
            <div className="ml-auto flex items-center gap-0.5">
              <IconButton label="Archive" hint="e" onClick={() => { void run(selected, { type: "archive" }); setSelected([]); }}><Archive size={15} /></IconButton>
              <IconButton label="Snooze" hint="h" onClick={() => useUI.getState().setPicker({ kind: "snooze", ids: selected })}><Clock size={15} /></IconButton>
              <IconButton label="Mark read" onClick={() => { void run(selected, { type: "read" }); setSelected([]); }}><MailOpen size={15} /></IconButton>
              <IconButton label="Label" hint="l" onClick={() => useUI.getState().setPicker({ kind: "label", ids: selected })}><Sparkles size={15} /></IconButton>
              <IconButton label="Trash" hint="#" onClick={() => { void run(selected, { type: "trash" }); setSelected([]); }}><Trash2 size={15} /></IconButton>
            </div>
          </>
        ) : (
          <>
            <h1 className="truncate text-[15px] font-semibold" data-testid="view-title">{view.title}</h1>
            {isFetching && !isLoading && <Spinner size={12} />}
            <button onClick={() => useUI.getState().setSearch(true)} className="ml-auto flex h-7 items-center gap-2 rounded-md border border-line px-2 text-[12.5px] text-faint hover:bg-hover" aria-label="Search" data-testid="search-btn">
              <Search size={13} /> Search <Kbd>/</Kbd>
            </button>
          </>
        )}
      </header>

      {view.kind === "inbox" && (
        <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line px-3 py-1.5" role="tablist" aria-label="Inbox split">
          {(["all", ...tabs] as const).map((c) => {
            const n = c === "all" ? counts.data?.unread : (counts.data?.byCategory[c] ?? 0);
            const active = view.category === c;
            return (
              <button key={c} role="tab" aria-selected={active} onClick={() => setParam("cat", c === "all" ? undefined : c)} className={cx("flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12.5px] transition-colors", active ? "bg-active font-medium text-fg" : "text-muted hover:bg-hover")}>
                {CAT_LABEL[c]}
                {!!n && <span className={cx("text-[11px] tabular-nums", active ? "text-fg" : "text-faint")}>{n}</span>}
              </button>
            );
          })}
        </div>
      )}

      {view.kind === "drafts" ? (
        <DraftsList />
      ) : (
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label={view.title} data-testid="thread-list">
          {isLoading && (
            <div className="space-y-px p-4">{Array.from({ length: 9 }).map((_, i) => <div key={i} className="skeleton mb-3 h-11" style={{ opacity: 1 - i * 0.09 }} />)}</div>
          )}
          {error && <div className="p-6 text-center text-[13px] text-danger">Couldn’t load mail: {(error as Error).message}</div>}
          {!isLoading && !error && threads.length === 0 && (
            initialSync ? (
              <Empty icon={<Spinner size={26} />} title="Syncing your mailbox…" hint="Your newest mail appears first; older mail keeps downloading in the background." />
            ) : view.kind === "inbox" ? (
              <Empty icon={<CheckCircle2 size={34} strokeWidth={1.5} />} title={view.category === "all" ? "Inbox zero" : "Nothing here"} hint={view.category === "all" ? "You’re all caught up. Enjoy the quiet." : "Nothing in this tab right now."} />
            ) : (
              <Empty icon={<InboxIcon size={32} strokeWidth={1.5} />} title={view.kind === "search" ? "No results" : "Nothing here"} hint={view.kind === "search" ? "Try fewer words, or use operators like from: or has:attachment." : undefined} />
            )
          )}
          {buckets.map((b) => (
            <div key={b.label}>
              <div className="sticky top-0 z-10 bg-bg/95 px-4 py-1 text-[11px] font-medium uppercase tracking-wide text-faint backdrop-blur">{b.label}</div>
              {b.items.map((t) => (
                <Row key={t.threadId} t={t} compact={compact} selected={view.threadId === t.threadId} checked={selected.includes(t.threadId)} onOpen={() => onOpen(t.threadId)} onCheck={() => toggleSelected(t.threadId)} showAcct={!view.accountId ? accountColor(t.accountId) : undefined} />
              ))}
            </div>
          ))}
          <div ref={sentinel} className="h-6" />
          {isFetchingNextPage && <div className="flex justify-center py-3"><Spinner /></div>}
          {!hasNextPage && threads.length > 8 && <div className="py-6 text-center text-[12px] text-faint">End of list</div>}
        </div>
      )}
      {view.kind === "drafts" && drafts.isLoading && null}
    </section>
  );
}

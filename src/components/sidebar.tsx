"use client";
import Link from "next/link";
import { useState } from "react";
import { Archive, ChevronDown, Clock, FileText, Folder, Inbox, PanelLeftClose, Plus, Send, Settings, Sparkles, Star, Tag, Trash2, Reply, ShieldAlert, Check, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccounts, useCounts, useDrafts, useFolders, useLabels, useSettings } from "@/lib/client/queries";
import { useView } from "@/lib/client/view";
import { useUI } from "@/lib/client/store";
import { api } from "@/lib/client/api";
import { cx, Kbd, Menu, MenuItem, Spinner } from "./ui";
import { openNewCompose } from "./compose-actions";
import { formatDistanceToNowStrict } from "date-fns";

function NavItem({ href, icon, label, count, active, shortcut, dot }: { href: string; icon: React.ReactNode; label: string; count?: number; active: boolean; shortcut?: string; dot?: string }) {
  return (
    <Link href={href} scroll={false} aria-current={active ? "page" : undefined} className={cx("group flex h-[30px] items-center gap-2.5 rounded-md px-2 text-[13.5px] transition-colors", active ? "bg-active font-medium text-fg" : "text-muted hover:bg-hover hover:text-fg")}>
      <span className={cx("flex w-4 justify-center", active ? "text-fg" : "text-faint group-hover:text-muted")} style={dot ? { color: dot } : undefined}>{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {!!count && <span className={cx("text-[12px] tabular-nums", active ? "text-fg" : "text-faint")}>{count > 999 ? "999+" : count}</span>}
      {shortcut && !count && <span className="hidden text-[11px] text-faint group-hover:inline">{shortcut}</span>}
    </Link>
  );
}

export function Sidebar() {
  const { view, href, router } = useView();
  const accounts = useAccounts();
  const folders = useFolders();
  const counts = useCounts(view.accountId);
  const labels = useLabels();
  const drafts = useDrafts();
  const settings = useSettings();
  const setSidebar = useUI((s) => s.setSidebar);
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  const accts = accounts.data ?? [];
  const current = accts.find((a) => a.id === view.accountId);
  const inboxUnread = view.accountId
    ? (folders.data ?? []).filter((f) => f.role === "inbox" && f.accountId === view.accountId).reduce((n, f) => n + f.unread, 0)
    : counts.data?.unread ?? 0;
  const roleCount = (role: string) => (folders.data ?? []).filter((f) => f.role === role && (!view.accountId || f.accountId === view.accountId)).reduce((n, f) => n + f.unread, 0);
  const custom = (folders.data ?? []).filter((f) => !f.role && (!view.accountId || f.accountId === view.accountId));
  const syncState = accts.some((a) => a.syncState === "syncing") ? "syncing" : accts.some((a) => a.syncState === "error") ? "error" : "idle";
  const last = Math.max(0, ...accts.map((a) => a.lastSyncedAt ?? 0));

  const sync = async () => {
    setSyncing(true);
    try { await api("/sync", { body: {} }); } finally { setTimeout(() => { setSyncing(false); void qc.invalidateQueries(); }, 800); }
  };

  const p = (path: string) => href(path);
  const is = (k: string) => view.kind === k;

  return (
    <aside className="flex h-full w-[232px] shrink-0 flex-col border-r border-line bg-surface" aria-label="Sidebar">
      <div className="flex items-center gap-1 px-2 pb-1 pt-2.5">
        <Menu align="left" width={248} trigger={({ toggle }) => (
          <button onClick={toggle} className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 hover:bg-hover" aria-label="Switch account">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-[11px] font-semibold" style={{ background: current?.color ?? "var(--fg)", color: current ? "#fff" : "var(--bg)" }}>{(current?.name ?? "M")[0].toUpperCase()}</span>
            <span className="min-w-0 flex-1 truncate text-left text-[13.5px] font-medium">{current ? current.name : "All inboxes"}</span>
            <ChevronDown size={13} className="text-faint" />
          </button>
        )}>
          {(close) => (
            <>
              <MenuItem icon={!view.accountId ? <Check size={14} /> : <span className="w-[14px]" />} onClick={() => { close(); router.push(href(view.slug.split("/")[0] || "inbox", { acct: "" }), { scroll: false }); }}>All inboxes</MenuItem>
              {accts.map((a) => (
                <MenuItem key={a.id} icon={view.accountId === a.id ? <Check size={14} /> : <span className="h-2 w-2 rounded-full" style={{ background: a.color }} />} onClick={() => { close(); router.push(href(view.slug.split("/")[0] || "inbox", { acct: a.id }), { scroll: false }); }}>
                  <span className="block truncate">{a.name}</span>
                  <span className="block truncate text-[11.5px] text-faint">{a.email}</span>
                </MenuItem>
              ))}
              <div className="my-1 h-px bg-line" />
              <Link href="/settings/accounts" onClick={close} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-hover"><Plus size={14} className="text-muted" /> Add account</Link>
            </>
          )}
        </Menu>
        <button aria-label="Hide sidebar" title="Hide sidebar ([)" onClick={() => setSidebar(false)} className="flex h-7 w-7 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-fg"><PanelLeftClose size={15} /></button>
      </div>

      <div className="px-2 pb-2 pt-1">
        <button onClick={() => void openNewCompose()} className="flex h-8 w-full items-center gap-2 rounded-md border border-line bg-bg px-2.5 text-[13px] font-medium shadow-[0_1px_0_rgba(0,0,0,0.02)] hover:bg-hover" data-testid="compose-btn">
          <Plus size={15} /> Compose <span className="ml-auto"><Kbd>c</Kbd></span>
        </button>
      </div>

      <nav className="flex-1 space-y-px overflow-y-auto px-2 pb-2" aria-label="Mailboxes">
        <NavItem href={p("inbox")} icon={<Inbox size={15} />} label="Inbox" count={inboxUnread} active={is("inbox")} />
        {(settings.data?._ai || (counts.data?.needsReply ?? 0) > 0) && <NavItem href={p("needs-reply")} icon={<Reply size={15} />} label="Needs reply" count={counts.data?.needsReply} active={is("needs-reply")} dot="var(--ai)" />}
        <NavItem href={p("starred")} icon={<Star size={15} />} label="Starred" active={is("starred")} />
        <NavItem href={p("snoozed")} icon={<Clock size={15} />} label="Snoozed" count={counts.data?.snoozed} active={is("snoozed")} />
        <NavItem href={p("drafts")} icon={<FileText size={15} />} label="Drafts" count={drafts.data?.length} active={is("drafts")} />
        <NavItem href={p("sent")} icon={<Send size={15} />} label="Sent" active={is("sent")} />
        <NavItem href={p("archive")} icon={<Archive size={15} />} label="Archive" active={is("archive")} />
        <NavItem href={p("spam")} icon={<ShieldAlert size={15} />} label="Spam" count={roleCount("junk")} active={is("spam")} />
        <NavItem href={p("trash")} icon={<Trash2 size={15} />} label="Trash" active={is("trash")} />

        {!!labels.data?.length && (
          <>
            <div className="px-2 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wide text-faint">Labels</div>
            {labels.data.map((l) => (
              <NavItem key={l.id} href={p(`label/${encodeURIComponent(l.name)}`)} icon={<Tag size={14} />} dot={l.color} label={l.name} active={is("label") && view.label?.toLowerCase() === l.name.toLowerCase()} />
            ))}
          </>
        )}
        {!!custom.length && (
          <>
            <div className="px-2 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wide text-faint">Folders</div>
            {custom.map((f) => (
              <NavItem key={f.id} href={href(`f/${f.id}`, { name: f.name })} icon={<Folder size={14} />} label={f.name} count={f.unread} active={is("folder") && view.folderId === f.id} />
            ))}
          </>
        )}
      </nav>

      <div className="space-y-px border-t border-line p-2">
        <button onClick={() => useUI.getState().setAgent(true)} className="flex h-[30px] w-full items-center gap-2.5 rounded-md px-2 text-[13.5px] text-muted hover:bg-hover hover:text-fg">
          <Sparkles size={15} className="text-ai" /> <span className="flex-1 text-left">Ask AI</span> <Kbd>⌘J</Kbd>
        </button>
        <Link href="/settings" className="flex h-[30px] items-center gap-2.5 rounded-md px-2 text-[13.5px] text-muted hover:bg-hover hover:text-fg"><Settings size={15} className="text-faint" /> Settings</Link>
        <button onClick={sync} className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[11.5px] text-faint hover:bg-hover" title="Sync now">
          {syncState === "syncing" || syncing ? <Spinner size={11} /> : <RefreshCw size={11} />}
          <span className={syncState === "error" ? "text-danger" : ""}>
            {syncState === "error" ? "Sync problem — check accounts" : syncState === "syncing" || syncing ? "Syncing…" : last ? `Synced ${formatDistanceToNowStrict(new Date(last * 1000), { addSuffix: true })}` : "Not synced yet"}
          </span>
        </button>
      </div>
    </aside>
  );
}

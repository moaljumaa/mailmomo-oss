"use client";
import { Command } from "cmdk";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, Clock, FileText, Inbox, Keyboard, Mail, MoonStar, PanelLeft, Plus, RefreshCw, Reply, ReplyAll, Forward, Search, Send, Settings, ShieldAlert, Sparkles, Star, Tag, Trash2, Wand2, Folder, KeyRound, Users, Workflow } from "lucide-react";
import { useAccounts, useLabels, useSettings, useThreadActions } from "@/lib/client/queries";
import { useUI } from "@/lib/client/store";
import { useView } from "@/lib/client/view";
import { api } from "@/lib/client/api";
import { Kbd, Modal } from "./ui";
import { openNewCompose, openReply } from "./compose-actions";

const item = "flex h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 text-[13.5px] data-[selected=true]:bg-hover";
const heading = "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-faint";

export function Palette({ activeId, lastMessageId }: { activeId?: string; lastMessageId?: string }) {
  const open = useUI((s) => s.paletteOpen);
  const setOpen = useUI((s) => s.setPalette);
  const [q, setQ] = useState("");
  const { view, go, router } = useView();
  const nav = useRouter();
  const { run } = useThreadActions();
  const labels = useLabels();
  const accounts = useAccounts();
  const settings = useSettings();
  const qc = useQueryClient();
  if (!open) return null;

  const close = () => { setOpen(false); setQ(""); };
  const doIt = (fn: () => void) => () => { close(); setTimeout(fn, 0); };
  const ai = settings.data?._ai;
  const setTheme = async (t: "light" | "dark" | "system") => { await api("/settings", { method: "PATCH", body: { theme: t } }); void qc.invalidateQueries({ queryKey: ["settings"] }); };

  return (
    <Modal open onClose={close} width={600} label="Command palette">
      <Command label="Command palette" loop className={heading}>
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search size={15} className="text-faint" />
          <Command.Input autoFocus value={q} onValueChange={setQ} data-testid="palette-input" placeholder="Type a command, search mail, or ask AI…" className="h-12 flex-1 bg-transparent text-[14.5px] placeholder:text-faint" />
          <Kbd>esc</Kbd>
        </div>
        <Command.List className="max-h-[420px] overflow-auto p-1.5">
          <Command.Empty className="px-3 py-6 text-center text-[13px] text-faint">No matching command.</Command.Empty>

          {activeId && (
            <Command.Group heading="This conversation">
              <Command.Item className={item} value="archive" onSelect={doIt(() => void run([activeId], { type: "archive" }))}><Archive size={15} className="text-muted" /> Archive <span className="ml-auto"><Kbd>e</Kbd></span></Command.Item>
              <Command.Item className={item} value="trash delete" onSelect={doIt(() => void run([activeId], { type: "trash" }))}><Trash2 size={15} className="text-muted" /> Move to trash <span className="ml-auto"><Kbd>#</Kbd></span></Command.Item>
              <Command.Item className={item} value="snooze later remind" onSelect={doIt(() => useUI.getState().setPicker({ kind: "snooze", ids: [activeId] }))}><Clock size={15} className="text-muted" /> Snooze… <span className="ml-auto"><Kbd>h</Kbd></span></Command.Item>
              <Command.Item className={item} value="label tag" onSelect={doIt(() => useUI.getState().setPicker({ kind: "label", ids: [activeId] }))}><Tag size={15} className="text-muted" /> Add label… <span className="ml-auto"><Kbd>l</Kbd></span></Command.Item>
              <Command.Item className={item} value="move folder" onSelect={doIt(() => useUI.getState().setPicker({ kind: "move", ids: [activeId] }))}><Folder size={15} className="text-muted" /> Move to…<span className="ml-auto"><Kbd>v</Kbd></span></Command.Item>
              <Command.Item className={item} value="star" onSelect={doIt(() => void run([activeId], { type: "star" }))}><Star size={15} className="text-muted" /> Star <span className="ml-auto"><Kbd>s</Kbd></span></Command.Item>
              <Command.Item className={item} value="mark unread" onSelect={doIt(() => void run([activeId], { type: "unread" }))}><Mail size={15} className="text-muted" /> Mark unread <span className="ml-auto"><Kbd>u</Kbd></span></Command.Item>
              <Command.Item className={item} value="spam junk" onSelect={doIt(() => void run([activeId], { type: "spam" }))}><ShieldAlert size={15} className="text-muted" /> Report spam <span className="ml-auto"><Kbd>!</Kbd></span></Command.Item>
              {lastMessageId && <>
                <Command.Item className={item} value="reply" onSelect={doIt(() => void openReply(lastMessageId, "reply"))}><Reply size={15} className="text-muted" /> Reply <span className="ml-auto"><Kbd>r</Kbd></span></Command.Item>
                <Command.Item className={item} value="reply all" onSelect={doIt(() => void openReply(lastMessageId, "reply_all"))}><ReplyAll size={15} className="text-muted" /> Reply all <span className="ml-auto"><Kbd>a</Kbd></span></Command.Item>
                <Command.Item className={item} value="forward" onSelect={doIt(() => void openReply(lastMessageId, "forward"))}><Forward size={15} className="text-muted" /> Forward <span className="ml-auto"><Kbd>f</Kbd></span></Command.Item>
              </>}
            </Command.Group>
          )}

          <Command.Group heading="Actions">
            <Command.Item className={item} value="compose new email write" onSelect={doIt(() => void openNewCompose())}><Plus size={15} className="text-muted" /> New message <span className="ml-auto"><Kbd>c</Kbd></span></Command.Item>
            {ai && <Command.Item className={item} value="ask ai assistant" onSelect={doIt(() => useUI.getState().setAgent(true))}><Sparkles size={15} className="text-ai" /> Ask AI assistant <span className="ml-auto"><Kbd>⌘J</Kbd></span></Command.Item>}
            <Command.Item className={item} value="clean up inbox suggestions bulk" onSelect={doIt(() => useUI.getState().setCleanup(true))}><Wand2 size={15} className="text-muted" /> Clean up inbox…</Command.Item>
            <Command.Item className={item} value="sync refresh fetch" onSelect={doIt(() => void api("/sync", { body: {} }).then(() => useUI.getState().toast({ text: "Syncing…" })))}><RefreshCw size={15} className="text-muted" /> Sync now</Command.Item>
          </Command.Group>

          <Command.Group heading="Go to">
            {[["inbox", "Inbox", <Inbox key="a" size={15} />, "g i"], ["needs-reply", "Needs reply", <Reply key="b" size={15} />, ""], ["starred", "Starred", <Star key="c" size={15} />, "g k"], ["snoozed", "Snoozed", <Clock key="d" size={15} />, "g h"], ["drafts", "Drafts", <FileText key="e" size={15} />, "g d"], ["sent", "Sent", <Send key="f" size={15} />, "g s"], ["archive", "Archive", <Archive key="g" size={15} />, "g a"], ["spam", "Spam", <ShieldAlert key="h" size={15} />, ""], ["trash", "Trash", <Trash2 key="i" size={15} />, "g t"], ["all", "All mail", <Mail key="j" size={15} />, ""]].map(([slug, label, icon, hint]) => (
              <Command.Item key={slug as string} className={item} value={`go ${label}`} onSelect={doIt(() => go(slug as string))}><span className="text-muted">{icon}</span> {label as string}{hint && <span className="ml-auto text-[11.5px] text-faint">{hint as string}</span>}</Command.Item>
            ))}
            {(labels.data ?? []).map((l) => <Command.Item key={l.id} className={item} value={`label ${l.name}`} onSelect={doIt(() => go(`label/${encodeURIComponent(l.name)}`))}><span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} /> Label: {l.name}</Command.Item>)}
          </Command.Group>

          {(accounts.data?.length ?? 0) > 1 && (
            <Command.Group heading="Account">
              <Command.Item className={item} value="account all inboxes" onSelect={doIt(() => router.push(`/mail/${view.slug.split("/")[0] || "inbox"}`))}><Users size={15} className="text-muted" /> All inboxes</Command.Item>
              {accounts.data!.map((a) => <Command.Item key={a.id} className={item} value={`account ${a.name} ${a.email}`} onSelect={doIt(() => router.push(`/mail/${view.slug.split("/")[0] || "inbox"}?acct=${a.id}`))}><span className="h-2.5 w-2.5 rounded-full" style={{ background: a.color }} /> {a.name} <span className="text-faint">{a.email}</span></Command.Item>)}
            </Command.Group>
          )}

          <Command.Group heading="Settings">
            <Command.Item className={item} value="settings preferences" onSelect={doIt(() => nav.push("/settings"))}><Settings size={15} className="text-muted" /> Settings</Command.Item>
            <Command.Item className={item} value="accounts add mailbox imap smtp" onSelect={doIt(() => nav.push("/settings/accounts"))}><Plus size={15} className="text-muted" /> Add account</Command.Item>
            <Command.Item className={item} value="rules automation filters" onSelect={doIt(() => nav.push("/settings/rules"))}><Workflow size={15} className="text-muted" /> Rules & automation</Command.Item>
            <Command.Item className={item} value="mcp api token assistant" onSelect={doIt(() => nav.push("/settings/api"))}><KeyRound size={15} className="text-muted" /> API & MCP tokens</Command.Item>
            <Command.Item className={item} value="theme dark mode" onSelect={doIt(() => void setTheme("dark"))}><MoonStar size={15} className="text-muted" /> Dark theme</Command.Item>
            <Command.Item className={item} value="theme light mode" onSelect={doIt(() => void setTheme("light"))}><MoonStar size={15} className="text-muted" /> Light theme</Command.Item>
            <Command.Item className={item} value="toggle sidebar" onSelect={doIt(() => useUI.getState().setSidebar(!useUI.getState().sidebarOpen))}><PanelLeft size={15} className="text-muted" /> Toggle sidebar <span className="ml-auto"><Kbd>[</Kbd></span></Command.Item>
            <Command.Item className={item} value="keyboard shortcuts help" onSelect={doIt(() => useUI.getState().setHelp(true))}><Keyboard size={15} className="text-muted" /> Keyboard shortcuts <span className="ml-auto"><Kbd>?</Kbd></span></Command.Item>
          </Command.Group>
          {q.trim().length > 1 && (
            <Command.Group heading="Mail">
              <Command.Item forceMount value={`search ${q}`} className={item} onSelect={doIt(() => go("search", { q: q.trim() }))}><Search size={15} className="text-muted" /> Search mail for “{q.trim()}”</Command.Item>
              {ai && <Command.Item forceMount value={`ask ai ${q}`} className={item} onSelect={doIt(() => { useUI.getState().setAgentSeed(q.trim()); useUI.getState().setAgent(true); })}><Sparkles size={15} className="text-ai" /> Ask AI: {q.trim()}</Command.Item>}
            </Command.Group>
          )}

        </Command.List>
      </Command>
    </Modal>
  );
}

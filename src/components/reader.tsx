"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowLeft, ChevronDown, Clock, Download, EyeOff, Forward, Mail, MailOpen, MoreHorizontal, Paperclip, Reply, ReplyAll, ShieldAlert, Sparkles, Star, Tag, Trash2, X, BellOff } from "lucide-react";
import { api } from "@/lib/client/api";
import { keys, useSettings, useThread, useThreadActions } from "@/lib/client/queries";
import { useUI } from "@/lib/client/store";
import { bytes, displayName, longTime, shortTime } from "@/lib/client/format";
import type { MessageDTO } from "@/lib/types";
import { Avatar, Button, cx, Empty, IconButton, Kbd, Menu, MenuItem, Spinner } from "./ui";
import { HtmlBody, TextBody } from "./message-body";
import { openReply } from "./compose-actions";

function AttachmentChip({ a }: { a: MessageDTO["attachments"][number] }) {
  return (
    <a href={`/api/attachments/${a.id}`} target="_blank" rel="noopener" download={a.filename} className="flex max-w-[260px] items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-[12.5px] hover:bg-hover">
      <Paperclip size={13} className="shrink-0 text-faint" />
      <span className="truncate">{a.filename}</span>
      <span className="shrink-0 text-faint">{bytes(a.size)}</span>
      <Download size={12} className="shrink-0 text-faint" />
    </a>
  );
}

function MessageCard({ m, defaultOpen, trusted, last }: { m: MessageDTO; defaultOpen: boolean; trusted: boolean; last: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [showDetails, setShowDetails] = useState(false);
  const [images, setImages] = useState(trusted);
  const settings = useSettings();
  const qc = useQueryClient();
  const allowImages = images || !!settings.data?.loadRemoteImages;
  const files = m.attachments.filter((a) => !a.inline || !m.bodyHtml);
  const who = displayName(m.from.name, m.from.address);

  const trust = useMutation({ mutationFn: () => api("/contacts/trust-images", { body: { email: m.from.address } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["trusted"] }) });

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex w-full items-center gap-3 border-b border-line/60 px-6 py-3 text-left hover:bg-hover" aria-label={`Expand message from ${who}`}>
        <Avatar name={m.from.name} addr={m.from.address} size={24} />
        <span className="w-36 shrink-0 truncate text-[13px] font-medium">{who}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{m.bodyText.replace(/\s+/g, " ").slice(0, 140)}</span>
        <span className="shrink-0 text-[12px] text-faint">{shortTime(m.date)}</span>
      </button>
    );
  }
  return (
    <article className={cx("px-6 py-4", !last && "border-b border-line/60")} data-testid="message-card" aria-label={`Message from ${who}`}>
      <header className="flex items-start gap-3">
        <Avatar name={m.from.name} addr={m.from.address} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[14px] font-semibold">{who}</span>
            <span className="truncate text-[12.5px] text-faint">{m.from.address}</span>
          </div>
          <button onClick={() => setShowDetails((v) => !v)} className="flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
            to {m.to.slice(0, 2).map((a) => displayName(a.name, a.address)).join(", ")}{m.to.length > 2 ? ` +${m.to.length - 2}` : ""}{m.cc.length ? `, cc ${m.cc.length}` : ""}
            <ChevronDown size={12} className={cx("transition-transform", showDetails && "rotate-180")} />
          </button>
          {showDetails && (
            <dl className="anim-fade mt-1.5 grid grid-cols-[48px_1fr] gap-x-2 gap-y-0.5 text-[12.5px] text-muted">
              <dt className="text-faint">From</dt><dd>{m.from.name} &lt;{m.from.address}&gt;</dd>
              <dt className="text-faint">To</dt><dd>{m.to.map((a) => a.address).join(", ")}</dd>
              {m.cc.length > 0 && (<><dt className="text-faint">Cc</dt><dd>{m.cc.map((a) => a.address).join(", ")}</dd></>)}
              <dt className="text-faint">Date</dt><dd>{longTime(m.date)}</dd>
            </dl>
          )}
        </div>
        <span className="shrink-0 pt-0.5 text-[12px] text-faint" title={longTime(m.date)}>{shortTime(m.date)}</span>
        <div className="flex shrink-0 items-center">
          <IconButton label="Reply" onClick={() => void openReply(m.id, "reply")}><Reply size={15} /></IconButton>
          <Menu trigger={({ toggle }) => <IconButton label="More" onClick={toggle}><MoreHorizontal size={15} /></IconButton>}>
            {(close) => (
              <>
                <MenuItem icon={<ReplyAll size={14} />} onClick={() => { close(); void openReply(m.id, "reply_all"); }}>Reply all</MenuItem>
                <MenuItem icon={<Forward size={14} />} onClick={() => { close(); void openReply(m.id, "forward"); }}>Forward</MenuItem>
              </>
            )}
          </Menu>
        </div>
      </header>

      {m.listUnsubscribe && last && <UnsubscribeBar id={m.id} />}
      {m.bodyHtml && m.hasRemoteImages && !allowImages && (
        <div className="mt-3 flex items-center gap-2 rounded-md bg-hover px-3 py-1.5 text-[12.5px] text-muted">
          <EyeOff size={13} /> Images are hidden to protect your privacy.
          <button className="font-medium text-accent hover:underline" onClick={() => setImages(true)}>Load images</button>
          <span className="text-faint">·</span>
          <button className="font-medium text-accent hover:underline" onClick={() => { setImages(true); trust.mutate(); }}>Always from {m.from.address}</button>
        </div>
      )}
      <div className="mt-3 pl-[44px]">
        {m.bodyHtml ? <HtmlBody html={m.bodyHtml} allowImages={allowImages} /> : <TextBody text={m.bodyText} />}
        {files.length > 0 && <div className="mt-3 flex flex-wrap gap-2" data-testid="attachments">{files.map((a) => <AttachmentChip key={a.id} a={a} />)}</div>}
      </div>
    </article>
  );
}

function UnsubscribeBar({ id }: { id: string }) {
  const toast = useUI((s) => s.toast);
  const m = useMutation({
    mutationFn: () => api<{ method: "mailto" | "url"; url?: string }>("/unsubscribe", { body: { messageId: id } }),
    onSuccess: (r) => { if (r.method === "url" && r.url) window.open(r.url, "_blank", "noopener"); else toast({ text: "Unsubscribe request sent" }); },
    onError: (e) => toast({ text: (e as Error).message, kind: "error" }),
  });
  return (
    <div className="mt-3 flex items-center gap-2 rounded-md bg-hover px-3 py-1.5 text-[12.5px] text-muted">
      <BellOff size={13} /> This looks like a mailing list.
      <button className="font-medium text-accent hover:underline" onClick={() => m.mutate()} disabled={m.isPending}>Unsubscribe</button>
    </div>
  );
}

function SummaryCard({ id, existing, count }: { id: string; existing: string | null; count: number }) {
  const ai = useSettings().data?._ai;
  const [text, setText] = useState<string | null>(null);
  const s = useMutation({ mutationFn: () => api<{ summary: string }>("/ai/summarize", { body: { id } }), onSuccess: (r) => setText(r.summary), onError: (e) => useUI.getState().toast({ text: (e as Error).message, kind: "error" }) });
  useEffect(() => setText(null), [id]);
  if (!ai && !existing) return null;
  const shown = text ?? existing;
  return (
    <div className="mx-6 mt-3 rounded-lg bg-ai-soft px-3.5 py-2.5 text-[13px]" data-testid="ai-summary">
      <div className="flex items-start gap-2">
        <Sparkles size={14} className="mt-0.5 shrink-0 text-ai" />
        <div className="min-w-0 flex-1 whitespace-pre-wrap">{shown ?? <span className="text-muted">Summarize this conversation</span>}</div>
        {ai && (count > 1 || !shown) && (
          <button onClick={() => s.mutate()} disabled={s.isPending} className="shrink-0 text-[12px] font-medium text-ai hover:underline">{s.isPending ? <Spinner size={12} /> : text ? "Refresh" : count > 1 ? "Summarize thread" : "Summarize"}</button>
        )}
      </div>
    </div>
  );
}

export function Reader({ threadId, onBack, onAfterAction }: { threadId: string | undefined; onBack: () => void; onAfterAction: (kind: string) => void }) {
  const { data, isLoading, error } = useThread(threadId);
  const { run } = useThreadActions();
  const settings = useSettings();
  const trustedQ = useQuery({ queryKey: ["trusted"], queryFn: () => api<string[]>("/contacts/trusted-images"), staleTime: 60_000 });
  const scroller = useRef<HTMLDivElement>(null);
  const readTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const msgs = data?.messages ?? [];
  const last = msgs.at(-1);
  const unread = msgs.some((m) => !m.seen);
  const starred = msgs.some((m) => m.flagged);

  // mark read shortly after the thread is actually shown
  useEffect(() => {
    clearTimeout(readTimer.current);
    if (!threadId || !data || !unread) return;
    readTimer.current = setTimeout(() => void run([threadId], { type: "read" }, { silent: true }), 700);
    return () => clearTimeout(readTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, data?.threadId, unread]);

  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); }, [threadId]);

  const labels = useMemo(() => {
    const m = new Map<string, { id: string; name: string; color: string }>();
    for (const x of msgs) for (const l of x.labels) m.set(l.name, l);
    return [...m.values()];
  }, [msgs]);

  if (!threadId) return <div className="hidden h-full flex-1 md:block"><Empty icon={<Mail size={34} strokeWidth={1.4} />} title="Select a conversation" hint="Use j / k to move, Enter to open. Press ⌘K for everything else." /></div>;
  if (isLoading && !data) return <div className="flex-1 p-8"><div className="skeleton mb-4 h-7 w-2/3" /><div className="skeleton mb-2 h-4 w-full" /><div className="skeleton mb-2 h-4 w-5/6" /><div className="skeleton h-4 w-4/6" /></div>;
  if (error || !data || !last) return <div className="flex-1"><Empty icon={<Mail size={30} />} title="Couldn’t open this conversation" hint="It may have been moved or deleted." /></div>;

  const act = (type: "archive" | "trash" | "spam") => { void run([data.threadId], { type }); onAfterAction(type); };
  const trusted = new Set(trustedQ.data ?? []);

  return (
    <section className="flex h-full min-w-0 flex-[1.4] flex-col border-l border-line bg-bg" aria-label="Conversation" data-testid="reader">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-3">
        <IconButton label="Back" className="md:hidden" onClick={onBack}><ArrowLeft size={16} /></IconButton>
        <div className="flex items-center gap-0.5">
          <IconButton label="Archive" hint="e" onClick={() => act("archive")} data-testid="archive-btn"><Archive size={15} /></IconButton>
          <IconButton label="Trash" hint="#" onClick={() => act("trash")}><Trash2 size={15} /></IconButton>
          <IconButton label="Snooze" hint="h" onClick={() => useUI.getState().setPicker({ kind: "snooze", ids: [data.threadId] })}><Clock size={15} /></IconButton>
          <IconButton label="Label" hint="l" onClick={() => useUI.getState().setPicker({ kind: "label", ids: [data.threadId] })}><Tag size={15} /></IconButton>
          <IconButton label={starred ? "Unstar" : "Star"} hint="s" active={starred} onClick={() => void run([data.threadId], { type: starred ? "unstar" : "star" })}><Star size={15} className={starred ? "fill-[#e8a838] text-[#e8a838]" : ""} /></IconButton>
          <IconButton label={unread ? "Mark read" : "Mark unread"} hint="u" onClick={() => void run([data.threadId], { type: unread ? "read" : "unread" }, { silent: true })}>{unread ? <MailOpen size={15} /> : <Mail size={15} />}</IconButton>
        </div>
        <div className="ml-auto">
          <Menu trigger={({ toggle }) => <IconButton label="More actions" onClick={toggle}><MoreHorizontal size={15} /></IconButton>} width={210}>
            {(close) => (
              <>
                <MenuItem icon={<Reply size={14} />} hint="r" onClick={() => { close(); void openReply(last.id, "reply"); }}>Reply</MenuItem>
                <MenuItem icon={<ReplyAll size={14} />} hint="a" onClick={() => { close(); void openReply(last.id, "reply_all"); }}>Reply all</MenuItem>
                <MenuItem icon={<Forward size={14} />} hint="f" onClick={() => { close(); void openReply(last.id, "forward"); }}>Forward</MenuItem>
                <div className="my-1 h-px bg-line" />
                <MenuItem icon={<Archive size={14} />} onClick={() => { close(); useUI.getState().setPicker({ kind: "move", ids: [data.threadId] }); }}>Move to…</MenuItem>
                <MenuItem icon={<ShieldAlert size={14} />} danger onClick={() => { close(); act("spam"); }}>Report spam</MenuItem>
              </>
            )}
          </Menu>
        </div>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-6 pb-1 pt-5">
          <h2 className="text-[20px] font-semibold leading-tight tracking-[-0.01em]" data-testid="reader-subject">{data.subject || "(no subject)"}</h2>
          {labels.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {labels.map((l) => (
                <span key={l.id} className="group inline-flex items-center gap-1 rounded px-1.5 py-px text-[11.5px]" style={{ background: `color-mix(in srgb, ${l.color} 16%, transparent)`, color: `color-mix(in srgb, ${l.color} 70%, var(--fg))` }}>
                  {l.name}
                  <button aria-label={`Remove ${l.name}`} className="hidden group-hover:inline" onClick={() => void run([data.threadId], { type: "unlabel", name: l.name }, { silent: true })}><X size={10} /></button>
                </span>
              ))}
            </div>
          )}
        </div>
        <SummaryCard id={last.id} existing={last.summary} count={msgs.length} />
        <div className="mt-2">
          {msgs.map((m, i) => (
            <MessageCard key={m.id} m={m} last={i === msgs.length - 1} defaultOpen={i === msgs.length - 1 || !m.seen} trusted={trusted.has(m.from.address) || !!settings.data?.loadRemoteImages} />
          ))}
        </div>
        <div className="sticky bottom-0 flex items-center gap-2 border-t border-line bg-bg/95 px-6 py-3 backdrop-blur">
          <Button variant="outline" onClick={() => void openReply(last.id, "reply")} data-testid="reply-btn"><Reply size={14} /> Reply <Kbd>r</Kbd></Button>
          <Button variant="ghost" onClick={() => void openReply(last.id, "reply_all")}><ReplyAll size={14} /> Reply all</Button>
          <Button variant="ghost" onClick={() => void openReply(last.id, "forward")}><Forward size={14} /> Forward</Button>
          {settings.data?._ai && <AiReplyButton id={last.id} />}
        </div>
      </div>
    </section>
  );
}

function AiReplyButton({ id }: { id: string }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (tone: string) => api<{ id: string }>("/ai/reply", { body: { messageId: id, tone } }),
    onSuccess: (d) => { void qc.invalidateQueries({ queryKey: keys.drafts }); useUI.getState().openCompose(d.id); },
    onError: (e) => useUI.getState().toast({ text: (e as Error).message, kind: "error" }),
  });
  return (
    <Menu align="left" width={170} trigger={({ toggle }) => (
      <Button variant="ghost" onClick={toggle} loading={m.isPending} data-testid="ai-reply-btn"><Sparkles size={14} className="text-ai" /> Draft reply</Button>
    )}>
      {(close) => (
        <>
          {[["concise", "Concise"], ["friendly", "Friendly"], ["formal", "Formal"], ["direct", "Direct"]].map(([k, l]) => (
            <MenuItem key={k} onClick={() => { close(); m.mutate(k); }}>{l}</MenuItem>
          ))}
        </>
      )}
    </Menu>
  );
}

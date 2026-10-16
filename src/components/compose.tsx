"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bold, ChevronDown, Clock, Italic, Link2, List, Maximize2, Minimize2, Minus, Paperclip, Send, Sparkles, Trash2, X, Wand2, ListOrdered, Quote } from "lucide-react";
import { api } from "@/lib/client/api";
import { keys, useAccounts, useSettings } from "@/lib/client/queries";
import { useUI } from "@/lib/client/store";
import type { Addr, DraftDTO } from "@/lib/types";
import { bytes } from "@/lib/client/format";
import { Button, cx, IconButton, Kbd, Menu, MenuItem, Spinner } from "./ui";
import { RecipientInput } from "./recipient-input";

type FullDraft = DraftDTO & { files: { id: string; filename: string; size: number }[] };

function isEmptyHtml(html: string) {
  return !html.replace(/<div class="mm-sig">[\s\S]*?<\/div>/g, "").replace(/<[^>]+>/g, "").replace(/&nbsp;|\s/g, "");
}

export function ComposeLayer() {
  const ids = useUI((s) => s.composeIds);
  const full = useUI((s) => s.composeFull);
  return (
    <>
      {full && <div className="fixed inset-0 z-40 bg-black/25" />}
      <div className={cx("pointer-events-none fixed bottom-0 right-4 z-50 flex items-end gap-3", full && "inset-0 right-0 items-center justify-center")}>
        {ids.map((id) => (full && full !== id ? null : <ComposeWindow key={id} draftId={id} />))}
      </div>
    </>
  );
}

function ComposeWindow({ draftId }: { draftId: string }) {
  const qc = useQueryClient();
  const close = useUI((s) => s.closeCompose);
  const minimized = useUI((s) => !!s.composeMin[s.composeIds.includes(draftId) ? draftId : ""]);
  const toggleMin = useUI((s) => s.toggleMin);
  const full = useUI((s) => s.composeFull === draftId);
  const setFull = useUI((s) => s.setFull);
  const toast = useUI((s) => s.toast);
  const accounts = useAccounts();
  const settings = useSettings();
  const { data: draft, error } = useQuery({ queryKey: ["draft", draftId], queryFn: () => api<FullDraft>(`/drafts/${draftId}`), staleTime: Infinity, gcTime: 0 });

  const [to, setTo] = useState<Addr[]>([]);
  const [cc, setCc] = useState<Addr[]>([]);
  const [bcc, setBcc] = useState<Addr[]>([]);
  const [subject, setSubject] = useState("");
  const [accountId, setAccountId] = useState("");
  const [files, setFiles] = useState<FullDraft["files"]>([]);
  const [showCc, setShowCc] = useState(false);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [sending, setSending] = useState(false);
  const [aiBar, setAiBar] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const loaded = useRef(false);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef({ to, cc, bcc, subject, accountId, html: "" });
  const subjectRef = useRef<HTMLInputElement>(null);
  const aiAvailable = settings.data?._ai;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ heading: false, codeBlock: false, link: { openOnClick: false, autolink: true } }), Placeholder.configure({ placeholder: "Write something…" })],
    content: "",
    editorProps: { attributes: { "aria-label": "Message body", "data-testid": "compose-body" } },
    onUpdate: ({ editor }) => { latest.current.html = editor.getHTML(); schedule(); },
  });

  // hydrate once
  useEffect(() => {
    if (!draft || loaded.current || !editor) return;
    loaded.current = true;
    setTo(draft.to); setCc(draft.cc); setBcc(draft.bcc); setSubject(draft.subject); setAccountId(draft.accountId); setFiles(draft.files);
    setShowCc(draft.cc.length > 0 || draft.bcc.length > 0);
    editor.commands.setContent(draft.bodyHtml, { emitUpdate: false });
    latest.current = { to: draft.to, cc: draft.cc, bcc: draft.bcc, subject: draft.subject, accountId: draft.accountId, html: draft.bodyHtml };
    if (draft.to.length && editor) editor.commands.focus("start");
  }, [draft, editor]);

  const save = useCallback(async () => {
    if (!dirty.current) return;
    dirty.current = false;
    setSaved("saving");
    const l = latest.current;
    try {
      await api(`/drafts/${draftId}`, { method: "PATCH", body: { accountId: l.accountId, to: l.to, cc: l.cc, bcc: l.bcc, subject: l.subject, bodyHtml: l.html } });
      setSaved("saved");
    } catch { dirty.current = true; setSaved("idle"); }
  }, [draftId]);

  const schedule = useCallback(() => {
    dirty.current = true;
    setSaved("idle");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 700);
  }, [save]);

  useEffect(() => { latest.current = { ...latest.current, to, cc, bcc, subject, accountId }; }, [to, cc, bcc, subject, accountId]);
  useEffect(() => { if (loaded.current) schedule(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [to, cc, bcc, subject, accountId]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const discard = useCallback(async (silent = false) => {
    clearTimeout(timer.current);
    dirty.current = false;
    try { await api(`/drafts/${draftId}`, { method: "DELETE" }); } catch {}
    void qc.invalidateQueries({ queryKey: keys.drafts });
    close(draftId);
    if (!silent) toast({ text: "Draft discarded" });
  }, [draftId, qc, close, toast]);

  const closeWindow = useCallback(async () => {
    clearTimeout(timer.current);
    const l = latest.current;
    const empty = !l.to.length && !l.cc.length && !l.subject.trim() && isEmptyHtml(l.html || "") && !files.length;
    if (empty) return discard(true);
    await save();
    void qc.invalidateQueries({ queryKey: keys.drafts });
    close(draftId);
    toast({ text: "Draft saved" });
  }, [files.length, discard, save, qc, close, draftId, toast]);

  const send = useCallback(async (at?: string) => {
    const l = latest.current;
    if (!l.to.length && !l.cc.length && !l.bcc.length) { toast({ text: "Add a recipient first", kind: "error" }); return; }
    if (!l.subject.trim() && !window.confirm("Send without a subject?")) { subjectRef.current?.focus(); return; }
    setSending(true);
    try {
      dirty.current = true;
      clearTimeout(timer.current);
      await save();
      const delay = settings.data?.undoSendSeconds ?? 10;
      const r = await api<{ draftId: string; sendAt: number }>(`/drafts/${draftId}/send`, { body: at ? { at } : { delaySeconds: delay } });
      close(draftId);
      void qc.invalidateQueries({ queryKey: keys.drafts });
      const wait = Math.max(0, r.sendAt * 1000 - Date.now());
      toast({
        text: at ? `Scheduled · ${new Date(r.sendAt * 1000).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}` : delay ? `Sending…` : "Sent",
        ttl: Math.max(4000, wait),
        undo: delay || at ? async () => {
          try { await api(`/drafts/${draftId}/cancel`, { body: {} }); useUI.getState().openCompose(draftId); void qc.invalidateQueries({ queryKey: keys.drafts }); }
          catch (e) { toast({ text: (e as Error).message, kind: "error" }); }
        } : undefined,
      });
    } catch (e) {
      toast({ text: (e as Error).message, kind: "error" });
    } finally { setSending(false); }
  }, [save, settings.data?.undoSendSeconds, draftId, close, qc, toast]);

  // ⌘/Ctrl+Enter sends; Esc closes
  useEffect(() => {
    const el = document.getElementById(`compose-${draftId}`);
    if (!el) return;
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void send(); }
      if ((e.metaKey || e.ctrlKey) && e.key === "k" && editor?.isFocused) { e.preventDefault(); const u = window.prompt("Link URL"); if (u) editor.chain().focus().extendMarkRange("link").setLink({ href: u }).run(); }
    };
    el.addEventListener("keydown", h);
    return () => el.removeEventListener("keydown", h);
  }, [send, draftId, editor]);

  const upload = async (fl: FileList | File[]) => {
    for (const f of Array.from(fl)) {
      const fd = new FormData();
      fd.set("file", f);
      try {
        const r = await api<{ id: string; filename: string; size: number }>(`/drafts/${draftId}/files`, { body: fd });
        setFiles((x) => [...x, r]);
      } catch (e) { toast({ text: (e as Error).message, kind: "error" }); }
    }
  };

  const runAi = async () => {
    if (!aiPrompt.trim()) return;
    setAiBusy(true);
    try {
      const r = await api<{ subject: string; body: string }>("/ai/compose", { body: { prompt: aiPrompt, to: to[0]?.address, subject: subject || undefined } });
      const html = r.body.split(/\n{2,}/).map((p) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`).join("");
      const cur = latest.current.html;
      const sig = cur.match(/<div class="mm-sig">[\s\S]*?<\/div>/)?.[0] ?? "";
      editor?.commands.setContent(html + sig);
      latest.current.html = editor?.getHTML() ?? html;
      if (!subject && r.subject) setSubject(r.subject);
      setAiBar(false); setAiPrompt("");
      schedule();
    } catch (e) { toast({ text: (e as Error).message, kind: "error" }); } finally { setAiBusy(false); }
  };

  const rewrite = async (mode: string) => {
    if (!editor) return;
    const sel = editor.state.selection;
    const hasSel = !sel.empty;
    const text = hasSel ? editor.state.doc.textBetween(sel.from, sel.to, "\n\n") : editor.getText({ blockSeparator: "\n\n" }).replace(/\n*--\s*[\s\S]*$/, "").trim();
    if (!text.trim()) return;
    setAiBusy(true);
    try {
      const r = await api<{ text: string }>("/ai/rewrite", { body: { text, mode } });
      const html = r.text.split(/\n{2,}/).map((p) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`).join("");
      if (hasSel) editor.chain().focus().insertContentAt({ from: sel.from, to: sel.to }, html).run();
      else {
        const sig = latest.current.html.match(/<div class="mm-sig">[\s\S]*?<\/div>/)?.[0] ?? "";
        editor.commands.setContent(html + sig);
      }
      schedule();
    } catch (e) { toast({ text: (e as Error).message, kind: "error" }); } finally { setAiBusy(false); }
  };

  const acct = accounts.data?.find((a) => a.id === accountId);
  const title = subject.trim() || "New message";
  const when = useMemo(() => [["Tomorrow morning", "tomorrow"], ["This weekend", "weekend"], ["Next Monday", "next week"], ["In 3 hours", "3h"]] as const, []);

  if (error) return null;

  return (
    <div
      id={`compose-${draftId}`}
      data-testid="compose-window"
      role="dialog"
      aria-label="New message"
      className={cx("pop pointer-events-auto flex flex-col overflow-hidden anim-fade", full ? "h-[82vh] w-[min(860px,94vw)]" : minimized ? "h-10 w-[340px]" : "h-[min(600px,84vh)] w-[min(560px,calc(100vw-24px))]")}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) void upload(e.dataTransfer.files); }}
      onKeyDown={(e) => { if (e.key === "Escape" && !e.defaultPrevented) { e.stopPropagation(); void closeWindow(); } }}
    >
      <div className="flex h-10 shrink-0 cursor-default items-center gap-1 border-b border-line bg-surface px-3" onDoubleClick={() => toggleMin(draftId)}>
        <button className="min-w-0 flex-1 truncate text-left text-[13px] font-medium" onClick={() => minimized && toggleMin(draftId)}>{title}</button>
        <span className="mr-1 text-[11.5px] text-faint" aria-live="polite">{saved === "saving" ? "Saving…" : saved === "saved" ? "Saved" : ""}</span>
        <IconButton label={minimized ? "Expand" : "Minimize"} onClick={() => toggleMin(draftId)}><Minus size={14} /></IconButton>
        <IconButton label={full ? "Exit full screen" : "Full screen"} onClick={() => setFull(full ? null : draftId)}>{full ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</IconButton>
        <IconButton label="Close" hint="Esc" onClick={() => void closeWindow()} data-testid="compose-close"><X size={14} /></IconButton>
      </div>

      {!minimized && (
        <>
          {!draft ? <div className="flex flex-1 items-center justify-center"><Spinner /></div> : (
            <div className="relative flex min-h-0 flex-1 flex-col">
              {dragOver && <div className="absolute inset-0 z-20 flex items-center justify-center bg-accent-soft text-[13px] font-medium text-accent">Drop to attach</div>}
              {(accounts.data?.length ?? 0) > 1 && (
                <div className="flex h-[34px] items-center gap-2 border-b border-line px-4">
                  <span className="w-8 text-[12.5px] text-faint">From</span>
                  <select aria-label="From account" value={accountId} onChange={(e) => setAccountId(e.target.value)} className="h-6 flex-1 bg-transparent text-[13px]">
                    {accounts.data!.map((a) => <option key={a.id} value={a.id}>{a.name} &lt;{a.email}&gt;</option>)}
                  </select>
                </div>
              )}
              <div className="relative">
                <RecipientInput label="To" value={to} onChange={setTo} autoFocus={!draft.to.length} testId="compose-to" />
                {!showCc && <button onClick={() => setShowCc(true)} className="absolute right-4 top-[7px] text-[12px] text-faint hover:text-fg">Cc Bcc</button>}
              </div>
              {showCc && <><RecipientInput label="Cc" value={cc} onChange={setCc} /><RecipientInput label="Bcc" value={bcc} onChange={setBcc} /></>}
              <input ref={subjectRef} data-testid="compose-subject" aria-label="Subject" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="h-[38px] shrink-0 border-b border-line bg-transparent px-4 text-[14px] font-medium placeholder:font-normal placeholder:text-faint" />

              {aiBar && (
                <div className="flex items-center gap-2 border-b border-line bg-ai-soft px-4 py-2">
                  <Sparkles size={14} className="shrink-0 text-ai" />
                  <input autoFocus value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void runAi(); if (e.key === "Escape") { e.stopPropagation(); setAiBar(false); } }} placeholder="Describe the email… e.g. “ask Dana to move our call to Thursday”" className="h-6 flex-1 bg-transparent text-[13px] placeholder:text-muted" data-testid="ai-compose-input" />
                  {aiBusy ? <Spinner /> : <Button size="sm" variant="primary" onClick={() => void runAi()}>Write</Button>}
                </div>
              )}

              <div className="editor min-h-0 flex-1 overflow-y-auto px-4 py-3" onClick={() => editor?.commands.focus()}>
                <EditorContent editor={editor} />
              </div>

              {files.length > 0 && (
                <div className="flex flex-wrap gap-1.5 border-t border-line px-4 py-2" data-testid="compose-files">
                  {files.map((f) => (
                    <span key={f.id} className="inline-flex max-w-[220px] items-center gap-1.5 rounded-md bg-hover px-2 py-1 text-[12px]">
                      <Paperclip size={11} className="shrink-0 text-faint" /><span className="truncate">{f.filename}</span><span className="text-faint">{bytes(f.size)}</span>
                      <button aria-label={`Remove ${f.filename}`} onClick={async () => { await api(`/uploads/${f.id}`, { method: "DELETE" }); setFiles((x) => x.filter((y) => y.id !== f.id)); }}><X size={11} className="text-faint hover:text-fg" /></button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex shrink-0 items-center gap-1 border-t border-line px-3 py-2">
                <div className="flex items-stretch">
                  <Button variant="primary" onClick={() => void send()} loading={sending} className="rounded-r-none pr-2.5" data-testid="send-btn"><Send size={13} /> Send <Kbd>⌘↵</Kbd></Button>
                  <Menu align="left" width={210} trigger={({ toggle }) => <Button variant="primary" onClick={toggle} className="rounded-l-none border-l border-bg/20 px-1.5" aria-label="Send later"><ChevronDown size={14} /></Button>}>
                    {(c) => (<>
                      <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-faint">Send later</div>
                      {when.map(([l, v]) => <MenuItem key={v} icon={<Clock size={13} />} onClick={() => { c(); void send(v); }}>{l}</MenuItem>)}
                    </>)}
                  </Menu>
                </div>
                <div className="mx-1 h-4 w-px bg-line" />
                <EditorBtn label="Bold" onClick={() => editor?.chain().focus().toggleBold().run()} active={editor?.isActive("bold")}><Bold size={14} /></EditorBtn>
                <EditorBtn label="Italic" onClick={() => editor?.chain().focus().toggleItalic().run()} active={editor?.isActive("italic")}><Italic size={14} /></EditorBtn>
                <EditorBtn label="Bulleted list" onClick={() => editor?.chain().focus().toggleBulletList().run()} active={editor?.isActive("bulletList")}><List size={14} /></EditorBtn>
                <EditorBtn label="Numbered list" onClick={() => editor?.chain().focus().toggleOrderedList().run()} active={editor?.isActive("orderedList")}><ListOrdered size={14} /></EditorBtn>
                <EditorBtn label="Quote" onClick={() => editor?.chain().focus().toggleBlockquote().run()} active={editor?.isActive("blockquote")}><Quote size={14} /></EditorBtn>
                <EditorBtn label="Link (⌘K)" onClick={() => { const u = window.prompt("Link URL"); if (u) editor?.chain().focus().extendMarkRange("link").setLink({ href: u }).run(); }} active={editor?.isActive("link")}><Link2 size={14} /></EditorBtn>
                <label className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg" title="Attach files">
                  <Paperclip size={14} /><input type="file" multiple className="hidden" data-testid="file-input" onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ""; }} />
                </label>
                {aiAvailable && (
                  <>
                    <div className="mx-1 h-4 w-px bg-line" />
                    <IconButton label="Write with AI" active={aiBar} onClick={() => setAiBar((v) => !v)} data-testid="ai-compose-btn"><Sparkles size={14} className="text-ai" /></IconButton>
                    <Menu align="left" width={170} trigger={({ toggle }) => <IconButton label="Improve with AI" onClick={toggle} disabled={aiBusy}>{aiBusy ? <Spinner size={13} /> : <Wand2 size={14} className="text-ai" />}</IconButton>}>
                      {(c) => (<>
                        {[["improve", "Improve writing"], ["shorten", "Make shorter"], ["fix", "Fix grammar"], ["formal", "More formal"], ["friendly", "Friendlier"]].map(([k, l]) => <MenuItem key={k} onClick={() => { c(); void rewrite(k); }}>{l}</MenuItem>)}
                      </>)}
                    </Menu>
                  </>
                )}
                <span className="ml-auto truncate text-[11.5px] text-faint">{acct?.email}</span>
                <IconButton label="Discard draft" onClick={() => void discard()} data-testid="discard-btn"><Trash2 size={14} /></IconButton>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function EditorBtn({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <IconButton label={label} active={active} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{children}</IconButton>;
}

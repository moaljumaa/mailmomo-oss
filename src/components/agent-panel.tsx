"use client";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Sparkles, X, FileText } from "lucide-react";
import { api } from "@/lib/client/api";
import { keys, useSettings } from "@/lib/client/queries";
import { useUI } from "@/lib/client/store";
import { cx, IconButton, Spinner } from "./ui";

type Msg = { role: "user" | "assistant"; content: string; actions?: { tool: string; ok: boolean; result?: unknown }[]; drafts?: string[] };

const SUGGESTIONS = ["Summarize my unread mail", "What needs a reply?", "Archive newsletters I've already read", "Find invoices from the last 3 months"];

const TOOL_LABEL: Record<string, string> = {
  archive: "Archived", trash: "Trashed", mark_read: "Marked read", star: "Starred", snooze: "Snoozed", add_label: "Labeled", create_draft: "Draft created", create_reply_draft: "Draft created",
  draft_reply_with_ai: "Draft created", create_rule: "Rule created", create_rule_from_text: "Rule created", move_to_folder: "Moved", mark_spam: "Marked spam", search_messages: "Searched", list_messages: "Listed", get_thread: "Read thread", get_message: "Read message", summarize_thread: "Summarized", inbox_stats: "Checked inbox",
};

export function AgentPanel() {
  const open = useUI((s) => s.agentOpen);
  const setOpen = useUI((s) => s.setAgent);
  const seed = useUI((s) => s.agentSeed);
  const setSeed = useUI((s) => s.setAgentSeed);
  const ai = useSettings().data?._ai;
  const qc = useQueryClient();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 50); }, [open]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [msgs, busy]);
  useEffect(() => { if (open && seed) { void send(seed); setSeed(""); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, seed]);

  const send = async (t: string) => {
    const q = t.trim();
    if (!q || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: q }];
    setMsgs(next); setText(""); setBusy(true);
    try {
      const r = await api<{ reply: string; actions: Msg["actions"]; drafts: string[] }>("/ai/agent", { body: { messages: next.map((m) => ({ role: m.role, content: m.content })) } });
      setMsgs([...next, { role: "assistant", content: r.reply, actions: r.actions, drafts: r.drafts }]);
      void qc.invalidateQueries();
    } catch (e) {
      setMsgs([...next, { role: "assistant", content: `Sorry — ${(e as Error).message}` }]);
    } finally { setBusy(false); }
  };

  if (!open) return null;
  return (
    <aside className="pop anim-pop fixed bottom-4 right-4 top-4 z-[60] flex w-[380px] max-w-[calc(100vw-32px)] flex-col overflow-hidden" aria-label="AI assistant" data-testid="agent-panel">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3.5">
        <Sparkles size={15} className="text-ai" />
        <span className="flex-1 text-[13.5px] font-semibold">Ask AI</span>
        {msgs.length > 0 && <button className="text-[12px] text-faint hover:text-fg" onClick={() => setMsgs([])}>Clear</button>}
        <IconButton label="Close" hint="Esc" onClick={() => setOpen(false)}><X size={14} /></IconButton>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3.5 py-3">
        {!ai && <div className="rounded-lg bg-hover p-3 text-[13px] text-muted">AI isn’t configured on this server. Set <code className="rounded bg-active px-1">LLM_API_KEY</code> and restart.</div>}
        {ai && msgs.length === 0 && (
          <div className="space-y-2">
            <p className="text-[13px] text-muted">I can search, summarize, label, archive and draft for you. I never send mail on my own — drafts wait for your review.</p>
            {SUGGESTIONS.map((s) => <button key={s} onClick={() => void send(s)} className="block w-full rounded-lg border border-line px-3 py-2 text-left text-[13px] hover:bg-hover">{s}</button>)}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={cx("flex flex-col gap-1.5", m.role === "user" && "items-end")}>
            <div className={cx("max-w-[92%] whitespace-pre-wrap rounded-xl px-3 py-2 text-[13px]", m.role === "user" ? "bg-fg text-bg" : "bg-hover")}>{m.content}</div>
            {m.actions && m.actions.filter((a) => a.ok && TOOL_LABEL[a.tool]).length > 0 && (
              <div className="flex max-w-[92%] flex-wrap gap-1">
                {m.actions.filter((a) => a.ok && TOOL_LABEL[a.tool]).map((a, j) => <span key={j} className="rounded bg-ai-soft px-1.5 py-0.5 text-[11px] text-ai">{TOOL_LABEL[a.tool]}{typeof (a.result as { affected?: number })?.affected === "number" ? ` · ${(a.result as { affected: number }).affected}` : ""}</span>)}
              </div>
            )}
            {m.drafts?.map((d) => (
              <button key={d} onClick={() => { useUI.getState().openCompose(d); void qc.invalidateQueries({ queryKey: keys.drafts }); }} className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[12px] hover:bg-hover"><FileText size={12} /> Open draft</button>
            ))}
          </div>
        ))}
        {busy && <div className="flex items-center gap-2 text-[12.5px] text-muted"><Spinner size={13} /> Working…</div>}
        <div ref={bottom} />
      </div>
      <form className="flex shrink-0 items-end gap-2 border-t border-line p-2.5" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <textarea ref={input} value={text} rows={1} onChange={(e) => setText(e.target.value)} disabled={!ai} data-testid="agent-input" aria-label="Ask AI" placeholder="Ask anything about your mail…"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(text); } if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }}
          className="max-h-28 min-h-8 flex-1 resize-none rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[13px] placeholder:text-faint focus:border-ai" />
        <button type="submit" disabled={!text.trim() || busy || !ai} aria-label="Send" className="flex h-8 w-8 items-center justify-center rounded-lg bg-fg text-bg disabled:opacity-30"><ArrowUp size={15} /></button>
      </form>
    </aside>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Search, Sparkles, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { useSettings } from "@/lib/client/queries";
import { useUI } from "@/lib/client/store";
import { useView } from "@/lib/client/view";
import { Spinner } from "./ui";

const HINTS = ["from:", "to:", "subject:", "has:attachment", "is:unread", "is:starred", "label:", "category:", "in:sent", "after:7d", "before:2026-01-01"];
const OP = /\b(from|to|subject|has|is|label|category|in|after|before):/i;

export function SearchBar() {
  const open = useUI((s) => s.searchOpen);
  const setOpen = useUI((s) => s.setSearch);
  const { view, go } = useView();
  const ai = useSettings().data?._ai;
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const nl = useMutation({
    mutationFn: (t: string) => api<{ query: string; explanation: string }>("/ai/search", { body: { text: t } }),
    onSuccess: (r) => { setText(r.query); go("search", { q: r.query }); useUI.getState().toast({ text: r.explanation, kind: "ai" }); },
    onError: (e) => useUI.getState().toast({ text: (e as Error).message, kind: "error" }),
  });

  useEffect(() => { if (open) { setText(view.kind === "search" ? view.q ?? "" : ""); setTimeout(() => input.current?.select(), 0); } }, [open, view.kind, view.q]);
  // live search while typing
  useEffect(() => {
    if (!open) return;
    const t = text.trim();
    if (!t) return;
    const h = setTimeout(() => go("search", { q: t }), 250);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, open]);

  if (!open) return null;
  const natural = !!ai && text.trim().split(/\s+/).length >= 3 && !OP.test(text);
  const close = () => { setOpen(false); if (view.kind === "search" && !text.trim()) go("inbox"); };
  return (
    <div className="absolute inset-x-0 top-0 z-30 border-b border-line bg-bg anim-fade">
      <div className="flex h-12 items-center gap-2 px-4">
        <Search size={15} className="text-faint" />
        <input
          ref={input} value={text} onChange={(e) => setText(e.target.value)} autoFocus data-testid="search-input" aria-label="Search mail"
          placeholder="Search mail — try from:alex has:attachment, or ask in plain English"
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.stopPropagation(); close(); }
            if (e.key === "Enter") { e.preventDefault(); if ((e.metaKey || e.ctrlKey) && ai && text.trim()) nl.mutate(text.trim()); else if (text.trim()) go("search", { q: text.trim() }); input.current?.blur(); }
            if (e.key === "ArrowDown") { e.preventDefault(); input.current?.blur(); }
          }}
          className="h-8 flex-1 bg-transparent text-[14px] placeholder:text-faint"
        />
        {nl.isPending && <Spinner />}
        {natural && !nl.isPending && (
          <button onClick={() => nl.mutate(text.trim())} className="flex items-center gap-1.5 rounded-md bg-ai-soft px-2 py-1 text-[12px] font-medium text-ai hover:opacity-80" data-testid="ai-search-btn">
            <Sparkles size={12} /> Search with AI <span className="kbd">⌘↵</span>
          </button>
        )}
        <button aria-label="Close search" onClick={close} className="flex h-7 w-7 items-center justify-center rounded-md text-faint hover:bg-hover"><X size={14} /></button>
      </div>
      {!text && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-2.5">
          {HINTS.map((h) => <button key={h} onClick={() => { setText((t) => (t ? t + " " : "") + h); input.current?.focus(); }} className="rounded-md bg-hover px-1.5 py-0.5 text-[11.5px] text-muted hover:text-fg">{h}</button>)}
        </div>
      )}
    </div>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { api, qs } from "@/lib/client/api";
import type { Addr } from "@/lib/types";
import { cx } from "./ui";

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

export function parseAddrs(text: string): { ok: Addr[]; bad: string[] } {
  const ok: Addr[] = [];
  const bad: string[] = [];
  for (const raw of text.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean)) {
    const m = raw.match(/^"?([^"<]*)"?\s*<([^>]+)>$/);
    const addr = (m ? m[2] : raw).trim().toLowerCase();
    if (EMAIL.test(addr)) ok.push({ name: m ? m[1].trim() : "", address: addr });
    else bad.push(raw);
  }
  return { ok, bad };
}

export function RecipientInput({ label, value, onChange, autoFocus, testId }: { label: string; value: Addr[]; onChange: (v: Addr[]) => void; autoFocus?: boolean; testId?: string }) {
  const [text, setText] = useState("");
  const [sugg, setSugg] = useState<Addr[]>([]);
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    const q = text.trim();
    if (q.length < 1) { setSugg([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await api<Addr[]>(`/contacts${qs({ q })}`);
        setSugg(r.filter((a) => !value.some((v) => v.address === a.address)));
        setIdx(0);
      } catch {}
    }, 120);
    return () => clearTimeout(t);
  }, [text, value]);

  const commit = (raw = text) => {
    const { ok, bad } = parseAddrs(raw);
    if (ok.length) onChange([...value, ...ok.filter((a) => !value.some((v) => v.address === a.address))]);
    setText(bad.join(", "));
    setInvalid(bad.length > 0);
    return ok.length > 0;
  };
  const pick = (a: Addr) => { onChange([...value, a]); setText(""); setSugg([]); input.current?.focus(); };

  return (
    <div className="flex min-h-[34px] items-start gap-2 border-b border-line px-4 py-1" onClick={() => input.current?.focus()}>
      <span className="w-8 shrink-0 pt-[6px] text-[12.5px] text-faint">{label}</span>
      <div className="relative flex min-w-0 flex-1 flex-wrap items-center gap-1 py-0.5">
        {value.map((a) => (
          <span key={a.address} className="group inline-flex max-w-[260px] items-center gap-1 rounded-md bg-hover px-1.5 py-0.5 text-[12.5px]" title={a.address}>
            <span className="truncate">{a.name || a.address}</span>
            <button type="button" aria-label={`Remove ${a.address}`} onClick={(e) => { e.stopPropagation(); onChange(value.filter((v) => v.address !== a.address)); }} className="text-faint hover:text-fg"><X size={11} /></button>
          </span>
        ))}
        <input
          ref={input}
          autoFocus={autoFocus}
          data-testid={testId}
          aria-label={label}
          value={text}
          onChange={(e) => { setText(e.target.value); setInvalid(false); }}
          onKeyDown={(e) => {
            if (sugg.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); setIdx((i) => (i + (e.key === "ArrowDown" ? 1 : sugg.length - 1)) % sugg.length); return; }
            if ((e.key === "Enter" || e.key === "Tab") && sugg.length && text.trim() && !text.includes("@")) { e.preventDefault(); pick(sugg[idx]); return; }
            if (e.key === "Enter" || e.key === "," || e.key === ";" || (e.key === " " && text.includes("@")) || (e.key === "Tab" && text.trim())) {
              if (text.trim()) { e.preventDefault(); commit(); }
              return;
            }
            if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
            if (e.key === "Escape" && sugg.length) { e.stopPropagation(); setSugg([]); }
          }}
          onBlur={() => { if (text.trim()) commit(); setTimeout(() => setSugg([]), 150); }}
          onPaste={(e) => { const t = e.clipboardData.getData("text"); if (/[,;\n]/.test(t)) { e.preventDefault(); commit(t); } }}
          className={cx("h-6 min-w-[120px] flex-1 bg-transparent text-[13px]", invalid && "text-danger")}
        />
        {sugg.length > 0 && (
          <div className="pop absolute left-0 top-full z-40 mt-1 w-[320px] p-1" role="listbox">
            {sugg.map((a, i) => (
              <button type="button" key={a.address} role="option" aria-selected={i === idx} onMouseDown={(e) => { e.preventDefault(); pick(a); }} className={cx("flex w-full flex-col rounded-md px-2 py-1 text-left", i === idx && "bg-hover")}>
                <span className="truncate text-[13px]">{a.name || a.address}</span>
                {a.name && <span className="truncate text-[11.5px] text-faint">{a.address}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

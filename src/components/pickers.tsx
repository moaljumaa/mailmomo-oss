"use client";
import { Command } from "cmdk";
import { useState } from "react";
import { Archive, Clock, Folder, Inbox, Plus, ShieldAlert, Tag, Trash2 } from "lucide-react";
import { useFolders, useLabels, useThreadActions } from "@/lib/client/queries";
import { useUI } from "@/lib/client/store";
import { parseWhen } from "@/lib/when";
import { format } from "date-fns";
import { Button, Modal } from "./ui";

const itemCls = "flex h-8 cursor-default items-center gap-2.5 rounded-md px-2.5 text-[13px] data-[selected=true]:bg-hover";

function snoozeOptions() {
  const now = new Date();
  const mk = (s: string) => parseWhen(s, now)!;
  return [
    { label: "Later today", sub: format(new Date(mk("later today") * 1000), "p"), when: mk("later today") },
    { label: "This evening", sub: "6:00 PM", when: mk("this evening") },
    { label: "Tomorrow", sub: format(new Date(mk("tomorrow") * 1000), "EEE p"), when: mk("tomorrow") },
    { label: "This weekend", sub: format(new Date(mk("weekend") * 1000), "EEE p"), when: mk("weekend") },
    { label: "Next week", sub: format(new Date(mk("next week") * 1000), "EEE, MMM d"), when: mk("next week") },
  ].filter((o) => o.when > Math.floor(Date.now() / 1000) + 600);
}

export function Pickers() {
  const picker = useUI((s) => s.picker);
  const setPicker = useUI((s) => s.setPicker);
  const { run } = useThreadActions();
  const labels = useLabels();
  const folders = useFolders();
  const [custom, setCustom] = useState("");
  const [q, setQ] = useState("");
  const close = () => { setPicker(null); setQ(""); setCustom(""); };
  if (!picker) return null;
  const ids = picker.ids;

  return (
    <Modal open onClose={close} width={380} label={picker.kind === "snooze" ? "Snooze" : picker.kind === "label" ? "Label" : "Move to"}>
      <Command label="Picker" loop shouldFilter={picker.kind !== "snooze"}>
        {picker.kind !== "snooze" && (
          <Command.Input autoFocus value={q} onValueChange={setQ} placeholder={picker.kind === "label" ? "Add label…" : "Move to…"} className="h-11 w-full border-b border-line bg-transparent px-4 text-[14px] placeholder:text-faint" />
        )}
        <Command.List className="max-h-[320px] overflow-auto p-1.5">
          {picker.kind === "snooze" && (
            <>
              <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">Snooze until</div>
              {snoozeOptions().map((o) => (
                <Command.Item key={o.label} className={itemCls} onSelect={() => { void run(ids, { type: "snooze", until: o.when }, { label: `Snoozed until ${o.label.toLowerCase()}` }); close(); }}>
                  <Clock size={14} className="text-muted" /> <span className="flex-1">{o.label}</span> <span className="text-[12px] text-faint">{o.sub}</span>
                </Command.Item>
              ))}
              <div className="mt-1 flex items-center gap-2 border-t border-line px-2.5 pt-2.5">
                <input type="datetime-local" aria-label="Custom snooze time" value={custom} onChange={(e) => setCustom(e.target.value)} className="h-8 flex-1 rounded-md border border-line bg-bg px-2 text-[13px]" />
                <Button size="sm" variant="primary" disabled={!custom} onClick={() => { const t = Math.floor(new Date(custom).getTime() / 1000); if (t > Date.now() / 1000) { void run(ids, { type: "snooze", until: t }, { label: "Snoozed" }); close(); } }}>Set</Button>
              </div>
            </>
          )}
          {picker.kind === "label" && (
            <>
              <Command.Empty className="px-3 py-2 text-[13px] text-faint">Type a name and press Enter to create it.</Command.Empty>
              {(labels.data ?? []).map((l) => (
                <Command.Item key={l.id} value={l.name} className={itemCls} onSelect={() => { void run(ids, { type: "label", name: l.name }); close(); }}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} /> {l.name}
                </Command.Item>
              ))}
              {q.trim() && !(labels.data ?? []).some((l) => l.name.toLowerCase() === q.trim().toLowerCase()) && (
                <Command.Item value={`create ${q}`} forceMount className={itemCls} onSelect={() => { void run(ids, { type: "label", name: q.trim() }); close(); }}>
                  <Plus size={14} className="text-muted" /> Create “{q.trim()}”
                </Command.Item>
              )}
            </>
          )}
          {picker.kind === "move" && (
            <>
              {[["inbox", "Inbox", <Inbox key="i" size={14} />], ["archive", "Archive", <Archive key="a" size={14} />], ["junk", "Spam", <ShieldAlert key="s" size={14} />], ["trash", "Trash", <Trash2 key="t" size={14} />]].map(([v, l, icon]) => (
                <Command.Item key={v as string} value={l as string} className={itemCls} onSelect={() => { void run(ids, { type: "move", folder: v as string }, { label: `Moved to ${l}` }); close(); }}>
                  <span className="text-muted">{icon}</span> {l as string}
                </Command.Item>
              ))}
              {(folders.data ?? []).filter((f) => !f.role).map((f) => (
                <Command.Item key={f.id} value={f.name} className={itemCls} onSelect={() => { void run(ids, { type: "move", folder: f.id }, { label: `Moved to ${f.name}` }); close(); }}>
                  <Folder size={14} className="text-muted" /> {f.name}
                </Command.Item>
              ))}
            </>
          )}
        </Command.List>
      </Command>
    </Modal>
  );
}

export { Tag };

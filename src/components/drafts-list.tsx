"use client";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, Trash2, Clock } from "lucide-react";
import { keys, useDrafts } from "@/lib/client/queries";
import { useUI } from "@/lib/client/store";
import { api } from "@/lib/client/api";
import { shortTime } from "@/lib/client/format";
import { Empty, IconButton, Spinner } from "./ui";

export function DraftsList() {
  const { data, isLoading } = useDrafts();
  const qc = useQueryClient();
  const open = useUI((s) => s.openCompose);
  if (isLoading) return <div className="flex justify-center p-8"><Spinner /></div>;
  if (!data?.length) return <Empty icon={<FileText size={32} strokeWidth={1.5} />} title="No drafts" hint="Press c to write something." />;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="drafts-list">
      {data.map((d) => (
        <div key={d.id} onClick={() => open(d.id)} className="group relative cursor-default border-b border-line/60 px-4 py-2.5 hover:bg-hover">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{d.to.length ? d.to.map((a) => a.name || a.address).join(", ") : <span className="text-faint">No recipient</span>}</span>
            {d.status === "scheduled" && <span className="inline-flex items-center gap-1 text-[11.5px] text-accent"><Clock size={11} />Sending…</span>}
            {d.status === "failed" && <span className="text-[11.5px] text-danger">Failed</span>}
            <span className="text-[11.5px] text-faint">{shortTime(d.updatedAt)}</span>
          </div>
          <div className="truncate text-[13px] text-muted">{d.subject || "(no subject)"} <span className="text-faint">— {d.bodyText.slice(0, 100)}</span></div>
          <div className="absolute right-2 top-1.5 hidden rounded-md border border-line bg-raised p-0.5 group-hover:flex">
            <IconButton label="Discard draft" onClick={async (e) => { e.stopPropagation(); await api(`/drafts/${d.id}`, { method: "DELETE" }); void qc.invalidateQueries({ queryKey: keys.drafts }); }}><Trash2 size={14} /></IconButton>
          </div>
        </div>
      ))}
    </div>
  );
}

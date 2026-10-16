"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wand2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { useUI } from "@/lib/client/store";
import { Button, Kbd, Modal, Spinner } from "./ui";

const GROUPS: [string, [string, string][]][] = [
  ["Navigate", [["j / k", "Next / previous conversation"], ["Enter", "Open conversation"], ["g i", "Go to Inbox"], ["g s", "Go to Sent"], ["g d", "Go to Drafts"], ["g a", "Go to Archive"], ["g k", "Go to Starred"], ["g h", "Go to Snoozed"], ["g t", "Go to Trash"], ["/", "Search"], ["⌘ K", "Command palette"], ["⌘ J", "Ask AI"]]],
  ["Act", [["e", "Archive (done)"], ["#", "Trash"], ["!", "Report spam"], ["s", "Star"], ["u", "Toggle unread"], ["h", "Snooze"], ["l", "Label"], ["v", "Move to…"], ["z", "Undo"], ["x", "Select conversation"]]],
  ["Write", [["c", "Compose"], ["r", "Reply"], ["a", "Reply all"], ["f", "Forward"], ["⌘ Enter", "Send"], ["Esc", "Close / save draft"]]],
  ["View", [["[", "Toggle sidebar"], ["?", "This help"]]],
];

export function HelpModal() {
  const open = useUI((s) => s.helpOpen);
  const setOpen = useUI((s) => s.setHelp);
  return (
    <Modal open={open} onClose={() => setOpen(false)} width={640} label="Keyboard shortcuts">
      <div className="p-5">
        <h2 className="mb-4 text-[15px] font-semibold">Keyboard shortcuts</h2>
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
          {GROUPS.map(([g, rows]) => (
            <div key={g}>
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">{g}</div>
              {rows.map(([k, d]) => (
                <div key={k} className="flex items-center justify-between py-[3px] text-[13px]"><span className="text-muted">{d}</span><span className="flex gap-1">{k.split(" ").map((x, i) => (x === "/" ? <span key={i} className="text-faint">/</span> : <Kbd key={i}>{x}</Kbd>))}</span></div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

type Suggestion = { id: string; title: string; description: string; count: number };
export function CleanupModal() {
  const open = useUI((s) => s.cleanupOpen);
  const setOpen = useUI((s) => s.setCleanup);
  const toast = useUI((s) => s.toast);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["cleanup"], queryFn: () => api<Suggestion[]>("/cleanup"), enabled: open, staleTime: 0 });
  const apply = useMutation({
    mutationFn: (id: string) => api<{ affected: number }>("/cleanup/apply", { body: { id } }),
    onSuccess: (r) => { toast({ text: `Cleaned up ${r.affected} message${r.affected === 1 ? "" : "s"}` }); void qc.invalidateQueries(); },
    onError: (e) => toast({ text: (e as Error).message, kind: "error" }),
  });
  return (
    <Modal open={open} onClose={() => setOpen(false)} width={520} label="Clean up inbox">
      <div className="p-5">
        <h2 className="mb-1 flex items-center gap-2 text-[15px] font-semibold"><Wand2 size={15} className="text-ai" /> Clean up your inbox</h2>
        <p className="mb-4 text-[13px] text-muted">One click archives these. Everything stays searchable in Archive.</p>
        {isLoading && <div className="flex justify-center p-6"><Spinner /></div>}
        {data && data.length === 0 && <div className="rounded-lg bg-hover p-4 text-center text-[13px] text-muted">Nothing to clean up — your inbox is already tidy.</div>}
        <div className="space-y-2">
          {data?.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-lg border border-line p-3">
              <div className="min-w-0 flex-1"><div className="text-[13.5px] font-medium">{s.title}</div><div className="text-[12.5px] text-muted">{s.description}</div></div>
              <Button variant="outline" size="sm" loading={apply.isPending && apply.variables === s.id} onClick={() => apply.mutate(s.id)}>Archive {s.count}</Button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

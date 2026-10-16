"use client";
import { useUI } from "@/lib/client/store";
import { Sparkles, X } from "lucide-react";

export function Toaster() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="pop anim-pop pointer-events-auto flex items-center gap-3 px-3.5 py-2 text-[13px]" style={t.kind === "error" ? { borderColor: "var(--danger)" } : undefined}>
          {t.kind === "ai" && <Sparkles size={14} className="text-ai" />}
          <span className={t.kind === "error" ? "text-danger" : ""}>{t.text}</span>
          {t.undo && (
            <button className="flex items-center gap-1.5 font-medium text-accent hover:underline" onClick={() => { t.undo?.(); dismiss(t.id); }}>
              Undo <span className="kbd">z</span>
            </button>
          )}
          <button aria-label="Dismiss" className="text-faint hover:text-fg" onClick={() => dismiss(t.id)}><X size={13} /></button>
        </div>
      ))}
    </div>
  );
}

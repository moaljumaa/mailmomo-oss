"use client";
import { forwardRef, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { hue, initials } from "@/lib/client/format";

export function cx(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(" ");
}

export const Button = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" | "danger"; size?: "sm" | "md"; loading?: boolean }>(
  function Button({ variant = "ghost", size = "md", loading, className, children, disabled, ...p }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled || loading}
        className={cx(
          "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:opacity-50",
          size === "sm" ? "h-7 px-2 text-[12.5px]" : "h-8 px-3 text-[13px]",
          variant === "primary" && "bg-fg text-bg hover:opacity-85",
          variant === "ghost" && "text-fg hover:bg-hover",
          variant === "outline" && "border border-line text-fg hover:bg-hover",
          variant === "danger" && "bg-danger text-white hover:opacity-90",
          className,
        )}
        {...p}
      >
        {loading && <Loader2 size={13} className="spin" />}
        {children}
      </button>
    );
  },
);

export const IconButton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; hint?: string; active?: boolean }>(
  function IconButton({ label, hint, active, className, children, ...p }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        title={hint ? `${label} (${hint})` : label}
        className={cx("inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-40", active && "bg-active text-fg", className)}
        {...p}
      >
        {children}
      </button>
    );
  },
);

export function Kbd({ children }: { children: React.ReactNode }) {
  return <span className="kbd">{children}</span>;
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <Loader2 size={size} className="spin text-faint" />;
}

export function Avatar({ name, addr, size = 28 }: { name: string; addr: string; size?: number }) {
  const h = hue(addr || name);
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 select-none items-center justify-center rounded-full font-medium"
      style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${h} 55% 90%)`, color: `hsl(${h} 45% 30%)` }}
    >
      {initials(name, addr)}
    </span>
  );
}

export function useOutside(ref: React.RefObject<HTMLElement | null>, onOut: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOut(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [ref, onOut, active]);
}

/** Minimal popover menu. */
export function Menu({ trigger, children, align = "right", width = 200 }: { trigger: (p: { open: boolean; toggle: () => void }) => React.ReactNode; children: (close: () => void) => React.ReactNode; align?: "left" | "right"; width?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false), open);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [open]);
  return (
    <div ref={ref} className="relative inline-block">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div className={cx("pop anim-pop absolute top-full z-50 mt-1 p-1", align === "right" ? "right-0" : "left-0")} style={{ width }} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ icon, children, hint, onClick, danger, disabled }: { icon?: React.ReactNode; children: React.ReactNode; hint?: string; onClick?: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick} className={cx("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-hover disabled:opacity-40", danger && "text-danger")}>
      {icon && <span className="text-muted">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {hint && <span className="kbd">{hint}</span>}
    </button>
  );
}

export function Modal({ open, onClose, children, width = 520, label }: { open: boolean; onClose: () => void; children: React.ReactNode; width?: number; label: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/30 px-4 pt-[12vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={label} className="pop anim-pop max-h-[76vh] w-full overflow-auto" style={{ maxWidth: width }}>
        {children}
      </div>
    </div>
  );
}

export function Empty({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-muted anim-fade">
      <div className="text-faint">{icon}</div>
      <div className="text-[15px] font-medium text-fg">{title}</div>
      {hint && <div className="max-w-xs text-[13px]">{hint}</div>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] text-faint">{hint}</span>}
    </label>
  );
}

export const inputCls = "h-8 w-full rounded-md border border-line bg-bg px-2.5 text-[13px] placeholder:text-faint focus:border-accent";

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={cx("relative h-[18px] w-[32px] shrink-0 rounded-full transition-colors", checked ? "bg-accent" : "bg-active")}>
      <span className={cx("absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all", checked ? "left-[16px]" : "left-[2px]")} />
    </button>
  );
}

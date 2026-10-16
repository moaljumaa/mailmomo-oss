"use client";
import { useEffect } from "react";
import { useSettings } from "@/lib/client/queries";

export function ThemeSync() {
  const t = useSettings().data?.theme;
  useEffect(() => {
    if (!t) return;
    try { localStorage.setItem("mm-theme", t); } catch {}
    const apply = () => { document.documentElement.dataset.theme = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light"; };
    apply();
    if (t !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [t]);
  return null;
}

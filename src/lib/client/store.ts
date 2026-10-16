"use client";
import { create } from "zustand";

export type Toast = { id: number; text: string; undo?: () => void; kind?: "info" | "error" | "ai"; ttl?: number };

type UI = {
  composeIds: string[];
  composeMin: Record<string, boolean>;
  composeFull: string | null;
  openCompose: (id: string) => void;
  closeCompose: (id: string) => void;
  toggleMin: (id: string) => void;
  setFull: (id: string | null) => void;

  paletteOpen: boolean;
  setPalette: (v: boolean) => void;
  helpOpen: boolean;
  setHelp: (v: boolean) => void;
  agentOpen: boolean;
  setAgent: (v: boolean) => void;
  agentSeed: string;
  setAgentSeed: (s: string) => void;
  mobileNav: boolean;
  setMobileNav: (v: boolean) => void;
  sidebarOpen: boolean;
  setSidebar: (v: boolean) => void;
  cleanupOpen: boolean;
  setCleanup: (v: boolean) => void;
  searchOpen: boolean;
  setSearch: (v: boolean) => void;

  selected: string[];
  setSelected: (ids: string[]) => void;
  toggleSelected: (id: string) => void;

  picker: null | { kind: "snooze" | "label" | "move"; ids: string[] };
  setPicker: (p: UI["picker"]) => void;

  toasts: Toast[];
  toast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;
};

let tid = 1;
export const useUI = create<UI>((set, get) => ({
  composeIds: [],
  composeMin: {},
  composeFull: null,
  openCompose: (id) => set((s) => ({ composeIds: s.composeIds.includes(id) ? s.composeIds : [...s.composeIds, id].slice(-3), composeMin: { ...s.composeMin, [id]: false } })),
  closeCompose: (id) => set((s) => ({ composeIds: s.composeIds.filter((x) => x !== id), composeFull: s.composeFull === id ? null : s.composeFull })),
  toggleMin: (id) => set((s) => ({ composeMin: { ...s.composeMin, [id]: !s.composeMin[id] } })),
  setFull: (id) => set({ composeFull: id }),

  paletteOpen: false,
  setPalette: (v) => set({ paletteOpen: v }),
  helpOpen: false,
  setHelp: (v) => set({ helpOpen: v }),
  agentOpen: false,
  setAgent: (v) => set({ agentOpen: v }),
  agentSeed: "",
  setAgentSeed: (s) => set({ agentSeed: s }),
  mobileNav: false,
  setMobileNav: (v) => set({ mobileNav: v }),
  sidebarOpen: true,
  setSidebar: (v) => set({ sidebarOpen: v }),
  cleanupOpen: false,
  setCleanup: (v) => set({ cleanupOpen: v }),
  searchOpen: false,
  setSearch: (v) => set({ searchOpen: v }),

  selected: [],
  setSelected: (ids) => set({ selected: ids }),
  toggleSelected: (id) => set((s) => ({ selected: s.selected.includes(id) ? s.selected.filter((x) => x !== id) : [...s.selected, id] })),

  picker: null,
  setPicker: (p) => set({ picker: p }),

  toasts: [],
  toast: (t) => {
    const id = tid++;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { ...t, id }] }));
    setTimeout(() => get().dismissToast(id), t.ttl ?? (t.undo ? 6000 : 3500));
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

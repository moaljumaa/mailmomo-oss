"use client";
import { api } from "@/lib/client/api";
import { useUI } from "@/lib/client/store";
import type { DraftDTO } from "@/lib/types";
import { getQueryClientRef } from "./qc-ref";
import { keys } from "@/lib/client/queries";

export async function openNewCompose(init: { accountId?: string; to?: string; subject?: string; body?: string } = {}) {
  try {
    const d = await api<DraftDTO>("/drafts", { body: { accountId: init.accountId, to: init.to ? [{ name: "", address: init.to }] : [], subject: init.subject ?? "", ...(init.body ? { bodyHtml: init.body } : {}) } });
    getQueryClientRef()?.invalidateQueries({ queryKey: keys.drafts });
    useUI.getState().openCompose(d.id);
    return d;
  } catch (e) {
    useUI.getState().toast({ text: (e as Error).message, kind: "error" });
  }
}

export async function openReply(messageId: string, mode: "reply" | "reply_all" | "forward") {
  try {
    const d = await api<DraftDTO>("/drafts/reply", { body: { messageId, mode } });
    getQueryClientRef()?.invalidateQueries({ queryKey: keys.drafts });
    useUI.getState().openCompose(d.id);
    return d;
  } catch (e) {
    useUI.getState().toast({ text: (e as Error).message, kind: "error" });
  }
}

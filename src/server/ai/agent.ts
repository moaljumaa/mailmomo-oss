import { z } from "zod";
import { callModel, jsonSchemaOf, textOf, INJECTION_NOTE, type AiMessage } from "./client";
import { allowed, runTool, tools, type ToolCtx } from "../tools";
import { getSettings, listAccounts } from "../mail/service";

export type AgentResult = { reply: string; actions: { tool: string; args: unknown; ok: boolean; result?: unknown }[]; drafts: string[] };

/**
 * The command-bar assistant. It uses exactly the same tools as the MCP server,
 * but never gets the `send` scope: it can prepare drafts, the human presses send.
 */
export async function runAgent(userId: string, history: { role: "user" | "assistant"; content: string }[], opts: { maxSteps?: number } = {}): Promise<AgentResult> {
  const ctx: ToolCtx = { userId, actor: "ai", scopes: new Set(["read", "write"]) };
  if (!getSettings(userId).aiEnabled) throw new Error("AI is disabled in settings");
  // the in-app agent only gets reversible tools: no permanent deletion, no bulk re-runs of rules
  const usable = tools.filter((t) => allowed(ctx, t) && !["delete_permanently", "run_rule_now"].includes(t.name));
  const accounts = listAccounts(userId).map((a) => `${a.name} <${a.email}> (id ${a.id})`).join("; ");
  const system = `You are the assistant built into the user's email client (Mailmomo). Today is ${new Date().toISOString().slice(0, 10)}.
Accounts: ${accounts || "none"}.
Help the user manage their mail: find, summarize, triage, label, archive, snooze, create rules and prepare drafts. 
- Always look things up with tools instead of guessing. Use list_messages/search_messages, then act on the returned ids.
- For bulk actions (archive/trash many threads) first search, then state how many you will affect, then do it only when the user's request clearly asks for it.
- You cannot send email. To write email, create a draft (create_draft / create_reply_draft / draft_reply_with_ai) and tell the user it is waiting in Drafts for review.
- Be brief. Plain text, no markdown headers. Mention concrete numbers (e.g. "Archived 14 threads").
${INJECTION_NOTE}`;

  const msgs: AiMessage[] = history.map((m) => ({ role: m.role, content: m.content }));
  const actions: AgentResult["actions"] = [];
  const drafts: string[] = [];
  const toolDefs = usable.map((t) => ({ name: t.name, description: t.description, input_schema: jsonSchemaOf(z.object(t.shape)) }));

  for (let step = 0; step < (opts.maxSteps ?? 8); step++) {
    const res = await callModel({ system, messages: msgs, tools: toolDefs, maxTokens: 1500 });
    const uses = res.content.filter((b) => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !uses.length) return { reply: textOf(res) || "Done.", actions, drafts };
    msgs.push({ role: "assistant", content: res.content });
    const results: { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }[] = [];
    for (const u of uses) {
      if (u.type !== "tool_use") continue;
      try {
        const out = await runTool(ctx, u.name, u.input);
        const o = out as { draftId?: string } | null;
        if (o?.draftId) drafts.push(o.draftId);
        actions.push({ tool: u.name, args: u.input, ok: true, result: out });
        results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out).slice(0, 30000) });
      } catch (e) {
        actions.push({ tool: u.name, args: u.input, ok: false, result: (e as Error).message });
        results.push({ type: "tool_result", tool_use_id: u.id, content: (e as Error).message, is_error: true });
      }
    }
    msgs.push({ role: "user", content: results });
  }
  return { reply: "I ran out of steps before finishing — here's what I did so far.", actions, drafts };
}

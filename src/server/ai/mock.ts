import type { AiRequest, AiResponse } from "./client";

/**
 * Deterministic stand-in for the model, enabled only with MAILMOMO_AI_MOCK=1.
 * It exists so the AI-driven UI and API flows can be tested end to end without network access or an API key.
 */
function msg(content: unknown[], stop: "end_turn" | "tool_use" = "end_turn"): AiResponse {
  return { id: "mock", type: "message", role: "assistant", model: "mock", content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } as unknown as AiResponse;
}
const tool = (name: string, input: unknown, id = "mock_" + name) => msg([{ type: "tool_use", id, name, input }], "tool_use");

export async function mockTransport(req: AiRequest): Promise<AiResponse> {
  const first = req.messages[0];
  const user = typeof first.content === "string" ? first.content : JSON.stringify(first.content);
  const forced = req.toolChoice && req.toolChoice.type === "tool" ? req.toolChoice.name : null;

  if (forced === "record_triage") {
    const items = [...user.matchAll(/<email id="([^"]+)">\n([\s\S]*?)\n<\/email>/g)].map((m) => {
      const body = m[2];
      const promo = /sale|% off|deal/i.test(body);
      const invoice = /invoice|receipt/i.test(body);
      const human = /needs? a reply|can you|please/i.test(body);
      return {
        id: m[1],
        category: promo ? "promotions" : invoice ? "updates" : "primary",
        priority: human ? 3 : promo ? 0 : 1,
        summary: promo ? "Promotional offer" : invoice ? "An invoice or receipt" : "A message from a person",
        needs_reply: human,
        labels: invoice ? ["Finance"] : [],
      };
    });
    return tool("record_triage", { items });
  }
  if (forced === "build_query") {
    const t = user.toLowerCase();
    const q = [/invoice/.test(t) && "invoice", /unread/.test(t) && "is:unread", /attach/.test(t) && "has:attachment", /stripe/.test(t) && "from:stripe"].filter(Boolean).join(" ") || user.split(/\s+/).slice(-1)[0];
    return tool("build_query", { query: q, explanation: `Searching for ${q}` });
  }
  if (forced === "build_rule") {
    const m = user.match(/from\s+(\S+)/i);
    return tool("build_rule", { name: `Rule: ${m?.[1] ?? "match"}`, matchAll: true, conditions: [{ field: "from", op: "contains", value: m?.[1] ?? "example.com" }], actions: [{ type: "label", value: "Auto" }, { type: "archive" }] });
  }
  if (forced === "write_email") return tool("write_email", { subject: "Quick question", body: `Hi,\n\nFollowing up on: ${user.slice(0, 80).replace(/\n/g, " ")}\n\nThanks!` });

  // agent loop
  if (req.tools && req.tools.length > 3 && !forced) {
    const last = req.messages.at(-1)!;
    const hasResult = Array.isArray(last.content) && last.content.some((b) => (b as { type: string }).type === "tool_result");
    if (!hasResult) return tool("inbox_stats", {});
    return msg([{ type: "text", text: "You're all caught up: I checked your inbox stats." }]);
  }
  // plain-text completions
  const sys = req.system;
  if (/Summarize email threads/.test(sys)) return msg([{ type: "text", text: "- Discussion about the project kickoff\n- Meeting proposed for Tuesday\nAction: confirm the time." }]);
  if (/write email replies/i.test(sys)) return msg([{ type: "text", text: "Thanks for your message — Tuesday works for me.\n\nBest" }]);
  if (/Rewrite the user's email text/.test(sys)) return msg([{ type: "text", text: `${user.trim()} (improved)` }]);
  return msg([{ type: "text", text: "OK" }]);
}

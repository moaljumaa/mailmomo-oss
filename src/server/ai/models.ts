import { db } from "../db";
import { env } from "../env";

export type ModelInfo = {
  id: string;
  lab: string;
  inputPerM: number | null; // USD per 1M tokens
  outputPerM: number | null;
  context: number | null;
  geo: string | null;
  /** provider keeps prompts/outputs */
  retention: boolean | null;
  /** provider may train on prompts/outputs; anything but an explicit `false` counts as unsafe */
  training: boolean | null;
  privacy: string | null;
};

type Raw = {
  id: string; api?: string; model_lab?: string; context_window?: number; geolocation?: string; supports_tool_calling?: boolean;
  pricing?: { input_price?: number; output_price?: number }[]; input_price?: number; output_price?: number;
  data_retention?: boolean; data_used_for_training?: boolean; privacy_comments?: string;
};

let cache: { at: number; models: ModelInfo[] } | null = null;

/** Chat models with tool calling (the app relies on tools) approved for this Requesty key. */
export async function listModels(): Promise<ModelInfo[]> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.models;
  if (!env.llmBaseUrl) return [];
  const res = await fetch(`${env.llmBaseUrl.replace(/\/$/, "")}/v1/models`, { headers: { Authorization: `Bearer ${env.llmKey}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Model list failed (${res.status})`);
  const raw = ((await res.json()) as { data?: Raw[] }).data ?? [];
  const perM = (n?: number) => (typeof n === "number" ? n * 1e6 : null);
  const models = raw
    .filter((m) => (m.api ?? "chat") === "chat" && m.supports_tool_calling !== false)
    .map<ModelInfo>((m) => {
      const p = m.pricing?.[0];
      return {
        id: m.id, lab: m.model_lab ?? m.id.split("/")[0], inputPerM: perM(p?.input_price ?? m.input_price), outputPerM: perM(p?.output_price ?? m.output_price),
        context: m.context_window ?? null, geo: m.geolocation ?? null, retention: m.data_retention ?? null, training: m.data_used_for_training ?? null, privacy: m.privacy_comments && m.privacy_comments !== "N/A" ? m.privacy_comments : null,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  cache = { at: Date.now(), models };
  return models;
}

export const trainingFree = (m: ModelInfo) => m.training === false;

export function activeModel(): string {
  const r = db().prepare("SELECT value FROM kv WHERE key = 'ai_model'").get() as { value: string } | undefined;
  return r?.value || env.aiModel;
}

export async function setActiveModel(id: string) {
  const m = (await listModels()).find((x) => x.id === id);
  if (!m) throw new Error("Unknown model");
  if (!trainingFree(m)) throw new Error("This model's provider may use your data for training");
  db().prepare("INSERT INTO kv (key, value) VALUES ('ai_model', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(id);
}

export function costOf(model: string, input: number, output: number): number | null {
  const m = cache?.models.find((x) => x.id === model);
  if (!m || m.inputPerM == null || m.outputPerM == null) return null;
  return (input * m.inputPerM + output * m.outputPerM) / 1e6;
}

export function recordUsage(model: string, input: number, output: number, cost: number | null) {
  db().prepare("INSERT INTO ai_usage (model, input_tokens, output_tokens, cost) VALUES (?,?,?,?)").run(model, input, output, cost);
}

export type UsageRow = { model: string; requests: number; input: number; output: number; cost: number };
export function usageSummary(days: number) {
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const byModel = db()
    .prepare("SELECT model, COUNT(*) AS requests, SUM(input_tokens) AS input, SUM(output_tokens) AS output, COALESCE(SUM(cost),0) AS cost FROM ai_usage WHERE at >= ? GROUP BY model ORDER BY cost DESC, requests DESC")
    .all(since) as UsageRow[];
  const byDay = db()
    .prepare("SELECT date(at,'unixepoch') AS day, COUNT(*) AS requests, COALESCE(SUM(cost),0) AS cost FROM ai_usage WHERE at >= ? GROUP BY day ORDER BY day")
    .all(since) as { day: string; requests: number; cost: number }[];
  return { days, byModel, byDay };
}

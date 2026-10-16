import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Central config. Secrets that are not provided via env are generated once and
 * persisted in DATA_DIR/.secrets.json (mode 0600) so a fresh self-host "just works".
 */
export const DATA_DIR = path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || "./data");

type Secrets = { masterKey: string; authSecret: string };
let cached: Secrets | null = null;

function loadSecrets(): Secrets {
  if (cached) return cached;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, ".secrets.json");
  let stored: Partial<Secrets> = {};
  try {
    stored = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {}
  const next: Secrets = {
    masterKey: process.env.MASTER_KEY || stored.masterKey || crypto.randomBytes(32).toString("base64"),
    authSecret: process.env.BETTER_AUTH_SECRET || stored.authSecret || crypto.randomBytes(32).toString("base64"),
  };
  if (next.masterKey !== stored.masterKey || next.authSecret !== stored.authSecret) {
    // only persist generated values (env-provided ones are the operator's job)
    const toStore: Partial<Secrets> = {
      masterKey: process.env.MASTER_KEY ? stored.masterKey : next.masterKey,
      authSecret: process.env.BETTER_AUTH_SECRET ? stored.authSecret : next.authSecret,
    };
    fs.writeFileSync(file, JSON.stringify(toStore), { mode: 0o600 });
  }
  cached = next;
  return next;
}

export const env = {
  get masterKey() {
    return loadSecrets().masterKey;
  },
  get authSecret() {
    return loadSecrets().authSecret;
  },
  get baseUrl() {
    return process.env.BETTER_AUTH_URL || process.env.APP_URL || "http://localhost:3000";
  },
  get allowSignup() {
    return process.env.ALLOW_SIGNUP === "true";
  },
  get redisUrl() {
    return process.env.REDIS_URL || "";
  },
  /** LLM_API_KEY (Requesty router) wins; ANTHROPIC_API_KEY talks to Anthropic directly. */
  get llmKey() {
    return process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY || "";
  },
  /** Anthropic-compatible endpoint. Defaults to the Requesty EU router when LLM_API_KEY is used. */
  get llmBaseUrl() {
    return process.env.LLM_BASE_URL || (process.env.LLM_API_KEY ? "https://router.eu.requesty.ai" : undefined);
  },
  /** Fallback until a model is picked in Settings → AI model & usage. */
  get aiModel() {
    return process.env.AI_MODEL || (this.llmBaseUrl ? "anthropic/claude-sonnet-5-5" : "claude-sonnet-5-5");
  },
  get syncDisabled() {
    return process.env.DISABLE_SYNC === "true";
  },
  /** initial backfill window in days for a freshly added account */
  get initialSyncDays() {
    return Number(process.env.INITIAL_SYNC_DAYS || 60);
  },
};

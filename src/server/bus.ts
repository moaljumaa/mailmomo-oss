import { EventEmitter } from "node:events";
import Redis from "ioredis";
import { env } from "./env";
import type { ServerEvent } from "@/lib/types";

/**
 * Event bus for SSE. In-process EventEmitter; if REDIS_URL is set events are
 * also fanned out through Redis pub/sub so multiple app processes stay in sync.
 */
type Envelope = { userId: string; event: ServerEvent; origin: string };
const CHANNEL = "mailmomo:events";
const g = globalThis as unknown as { __mmbus?: { em: EventEmitter; pub?: Redis; origin: string } };

function bus() {
  if (g.__mmbus) return g.__mmbus;
  const em = new EventEmitter();
  em.setMaxListeners(0);
  const origin = Math.random().toString(36).slice(2);
  const b: { em: EventEmitter; pub?: Redis; origin: string } = { em, origin };
  if (env.redisUrl) {
    try {
      const opts = { maxRetriesPerRequest: 2, lazyConnect: false };
      b.pub = new Redis(env.redisUrl, opts);
      const sub = new Redis(env.redisUrl, opts);
      b.pub.on("error", () => {});
      sub.on("error", () => {});
      sub.subscribe(CHANNEL).catch(() => {});
      sub.on("message", (_c, raw) => {
        try {
          const e = JSON.parse(raw) as Envelope;
          if (e.origin !== origin) em.emit("event", e);
        } catch {}
      });
    } catch {}
  }
  g.__mmbus = b;
  return b;
}

export function publish(userId: string, event: ServerEvent) {
  const b = bus();
  const env_: Envelope = { userId, event, origin: b.origin };
  b.em.emit("event", env_);
  b.pub?.publish(CHANNEL, JSON.stringify(env_)).catch(() => {});
}

export function subscribe(userId: string, fn: (e: ServerEvent) => void): () => void {
  const h = (e: Envelope) => {
    if (e.userId === userId) fn(e.event);
  };
  const b = bus();
  b.em.on("event", h);
  return () => b.em.off("event", h);
}

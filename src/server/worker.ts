import { db } from "./db";
import { authReady } from "./auth";
import { startAllSyncs } from "./mail/sync";
import { deliverDraft, snoozeTick } from "./mail/service";
import { triageTick } from "./ai/features";
import { aiAvailable } from "./ai/client";

const g = globalThis as unknown as { __mmworkers?: boolean };

/** Starts background loops once per process: IMAP sync, send queue, snooze wake-ups, AI triage. */
export async function startWorkers() {
  if (g.__mmworkers) return;
  g.__mmworkers = true;
  await authReady();
  db().prepare("UPDATE drafts SET status = 'scheduled' WHERE status = 'sending'").run();
  startAllSyncs();

  setInterval(() => {
    try {
      const due = db().prepare("SELECT id FROM drafts WHERE status = 'scheduled' AND send_at IS NOT NULL AND send_at <= unixepoch()").all() as { id: string }[];
      for (const d of due) void deliverDraft(d.id).catch((e) => console.error("[send]", e));
    } catch (e) {
      console.error("[send-worker]", e);
    }
  }, 1000).unref();

  setInterval(() => {
    try { snoozeTick(); } catch (e) { console.error("[snooze]", e); }
  }, 20_000).unref();

  let busy = false;
  setInterval(async () => {
    if (busy || !aiAvailable()) return;
    busy = true;
    try {
      while ((await triageTick()) > 0) await new Promise((r) => setTimeout(r, 1500));
    } catch (e) {
      console.error("[ai-worker]", (e as Error).message);
    } finally {
      busy = false;
    }
  }, 5000).unref();
}

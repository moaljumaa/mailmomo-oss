import type { Category } from "@/lib/types";

const NOREPLY = /(^|[._-])(no-?reply|donotreply|do-not-reply|notifications?|alerts?|mailer-daemon|bounce|automated|system|billing|invoice|receipts?|noreply)([._+@-]|$)/i;
const SOCIAL = /(linkedin|facebook|twitter|x\.com|instagram|tiktok|reddit|pinterest|youtube|discord|slack|github|gitlab|meetup)/i;
const PROMO = /(sale|% off|discount|deal|offer|coupon|promo|limited time|black friday|free shipping|save \d+)/i;
const UPDATES = /(receipt|invoice|order|shipping|shipped|delivery|payment|statement|password|verify|verification|security alert|sign.?in|your account|confirm|booking|reservation|ticket|renewal)/i;

export type HeuristicInput = {
  fromAddr: string;
  subject: string;
  listUnsubscribe: string | null;
  hasListId: boolean;
  precedenceBulk: boolean;
  autoSubmitted: boolean;
};

/** Cheap, instant categorization used at ingest; AI refines it later. */
export function heuristicCategory(i: HeuristicInput): Category {
  if (SOCIAL.test(i.fromAddr.split("@")[1] || "")) return "social";
  if (i.listUnsubscribe || i.hasListId || i.precedenceBulk) {
    return PROMO.test(i.subject) ? "promotions" : "newsletters";
  }
  if (NOREPLY.test(i.fromAddr.split("@")[0] + "@") || i.autoSubmitted) return UPDATES.test(i.subject) ? "updates" : "updates";
  if (PROMO.test(i.subject)) return "promotions";
  return "primary";
}

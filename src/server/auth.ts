import { betterAuth, type BetterAuthOptions } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { getMigrations } from "better-auth/db/migration";
import { APIError } from "better-auth/api";
import { db } from "./db";
import { env } from "./env";

function options() {
  const database = db().raw; // better-auth needs the raw DatabaseSync instance
  return {
    appName: "Mailmomo",
    baseURL: env.baseUrl,
    secret: env.authSecret,
    database,
    trustedOrigins: [env.baseUrl, ...(process.env.TRUSTED_ORIGINS?.split(",").filter(Boolean) ?? [])],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 14,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 60 },
    },
    rateLimit: { enabled: true, window: 60, max: 120 },
    advanced: {
      useSecureCookies: env.baseUrl.startsWith("https://"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
    databaseHooks: {
      user: {
        create: {
          // Self-hosted: first account becomes the owner; signup closes afterwards.
          before: async (user) => {
            const n = (database.prepare("SELECT COUNT(*) c FROM user").get() as { c: number }).c;
            if (n > 0 && !env.allowSignup) {
              throw new APIError("FORBIDDEN", { message: "Sign-up is closed on this instance." });
            }
            return { data: user };
          },
        },
      },
    },
    plugins: [nextCookies()],
  } satisfies BetterAuthOptions;
}

const build = () => betterAuth(options());
type Auth = ReturnType<typeof build>;
const g = globalThis as unknown as { __mmauth?: Auth; __mmauthReady?: Promise<void> };

export function auth(): Auth {
  if (!g.__mmauth) g.__mmauth = build();
  return g.__mmauth;
}

/** Ensure better-auth tables exist (idempotent). */
export function authReady(): Promise<void> {
  if (!g.__mmauthReady) {
    g.__mmauthReady = (async () => {
      // create tables first, then instantiate (better-auth validates the schema on init)
      const { runMigrations } = await getMigrations(options() as BetterAuthOptions);
      await runMigrations();
      auth();
    })();
  }
  return g.__mmauthReady;
}

export function hasUsers(): boolean {
  try {
    return (db().prepare("SELECT COUNT(*) c FROM user").get() as { c: number }).c > 0;
  } catch {
    return false;
  }
}

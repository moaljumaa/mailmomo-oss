import crypto from "node:crypto";
import { env } from "./env";

// AES-256-GCM with a key derived from MASTER_KEY. Format: v1:iv:tag:ciphertext (base64)
function key(): Buffer {
  return crypto.createHash("sha256").update(env.masterKey).digest();
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function decrypt(payload: string): string {
  const [v, iv, tag, data] = payload.split(":");
  if (v !== "v1") throw new Error("Unsupported ciphertext version");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export function randomToken(prefix = "mm"): string {
  return `${prefix}_${crypto.randomBytes(32).toString("base64url")}`;
}

export function uid(): string {
  return crypto.randomUUID();
}

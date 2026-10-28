import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Cifra dos tokens da Meta (AES-256-GCM) com a chave ADS_TOKEN_KEY
 * (32 bytes em base64), que só existe no servidor. A base de dados guarda
 * apenas o texto cifrado; nem os utilizadores nem uma fuga da base de dados
 * expõem o token.
 */

function key(): Buffer {
  const raw = process.env.ADS_TOKEN_KEY;
  if (!raw) throw new Error("ads_not_configured");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("ads_key_invalid");
  return k;
}

export function isAdsCryptoConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${enc.toString("base64url")}.${tag.toString("base64url")}`;
}

export function decryptToken(payload: string): string {
  const [v, iv, enc, tag] = payload.split(".");
  if (v !== "v1" || !iv || !enc || !tag) throw new Error("token_invalid");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(enc, "base64url")), decipher.final()]).toString("utf8");
}

/** Estado assinado para o OAuth (impede pedidos forjados e troca de escritório). */
export function signState(data: Record<string, string | number>): string {
  const body = Buffer.from(JSON.stringify(data)).toString("base64url");
  const sig = createHmac("sha256", key()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState<T>(state: string | null): T | null {
  if (!state) return null;
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", key()).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp?: number };
    if (typeof data.exp === "number" && data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

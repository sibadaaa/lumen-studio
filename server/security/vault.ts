import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { paths } from "../config.js";

/**
 * AES-256-GCM secret vault.
 *
 * Key material is derived from APP_SECRET with scrypt. When no secret is
 * configured a random 32-byte key is generated once at data/master.key with
 * mode 0600. Ciphertexts are versioned as v1:<iv>:<tag>:<ciphertext>.
 */
export class SecretVault {
  private readonly key: Buffer;
  readonly source: "env" | "file";

  constructor(secret = "", keyFile = paths.masterKey) {
    if (secret.trim()) {
      this.key = crypto.scryptSync(secret, "lumen-bff-v1", 32);
      this.source = "env";
      return;
    }
    if (fs.existsSync(keyFile)) {
      const existing = Buffer.from(fs.readFileSync(keyFile, "utf8").trim(), "base64");
      if (existing.length !== 32) throw new Error("master.key is corrupted (expected 32 bytes)");
      this.key = existing;
      this.source = "file";
      return;
    }
    fs.mkdirSync(path.dirname(keyFile), { recursive: true, mode: 0o700 });
    const generated = crypto.randomBytes(32);
    fs.writeFileSync(keyFile, `${generated.toString("base64")}\n`, { mode: 0o600 });
    this.key = generated;
    this.source = "file";
  }

  encrypt(plaintext: string): string {
    if (!plaintext) return "";
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ["v1", iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
  }

  decrypt(payload: string): string {
    if (!payload) return "";
    const [version, ivB64, tagB64, dataB64] = payload.split(":");
    if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) throw new Error("invalid ciphertext format");
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  }
}

export function maskSecret(secret: string): string {
  if (!secret) return "";
  if (secret.length <= 8) return "••••••••";
  return `${secret.slice(0, 4)}••••••${secret.slice(-4)}`;
}

let vault: SecretVault | null = null;

export function getVault(): SecretVault {
  if (!vault) vault = new SecretVault(process.env.APP_SECRET || process.env.LUMEN_MASTER_KEY || "");
  return vault;
}

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SecretVault, maskSecret } from "../security/vault.js";

test("AES-256-GCM vault round-trips secrets without plaintext leakage", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lumen-vault-"));
  const keyFile = path.join(dir, "master.key");
  const vault = new SecretVault("", keyFile);
  const plaintext = "ark-secret-key-1234567890";
  const ciphertext = vault.encrypt(plaintext);
  assert.ok(ciphertext.startsWith("v1:"));
  assert.equal(ciphertext.includes(plaintext), false);
  assert.equal(vault.decrypt(ciphertext), plaintext);
  assert.equal(maskSecret(plaintext), "ark-••••••7890");
  assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("encrypted payload is authenticated and tamper-evident", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lumen-vault-"));
  const vault = new SecretVault("unit-test-secret", path.join(dir, "master.key"));
  const ciphertext = vault.encrypt("super-secret");
  const parts = ciphertext.split(":");
  const data = Buffer.from(parts[3], "base64");
  data[0] ^= 0xff;
  parts[3] = data.toString("base64");
  assert.throws(() => vault.decrypt(parts.join(":")));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("environment secret derives the same key deterministically", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lumen-vault-"));
  const keyFile = path.join(dir, "master.key");
  const a = new SecretVault("same-secret", keyFile);
  const b = new SecretVault("same-secret", keyFile);
  assert.equal(b.decrypt(a.encrypt("roundtrip")), "roundtrip");
  assert.equal(fs.existsSync(keyFile), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

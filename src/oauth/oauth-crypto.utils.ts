/**
 * AES-256-CBC encryption for OAuth tokens.
 * Compatible with ToolCredentialManager encryption format.
 */
import * as crypto from "crypto";
import type { OAuthTokens } from "./oauth-token.interfaces";

const ALGORITHM = "aes-256-cbc";
const IV_LENGTH = 16;

/**
 * Encrypt OAuth tokens to a storable string.
 * Format: `iv_hex:encrypted_hex`
 */
export function encryptTokens(tokens: OAuthTokens, key: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(key), iv);
  const json = JSON.stringify(tokens);
  let encrypted = cipher.update(json, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

/**
 * Decrypt a stored string back to OAuth tokens.
 */
export function decryptTokens(encrypted: string, key: string): OAuthTokens {
  const separatorIndex = encrypted.indexOf(":");
  if (separatorIndex === -1) {
    throw new Error("Invalid encrypted token format");
  }

  const ivHex = encrypted.substring(0, separatorIndex);
  const encryptedData = encrypted.substring(separatorIndex + 1);

  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(key), iv);
  let decrypted = decipher.update(encryptedData, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return JSON.parse(decrypted);
}

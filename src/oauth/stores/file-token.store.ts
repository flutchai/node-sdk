/**
 * File-based OAuth token store.
 * Stores encrypted tokens in a JSON file on disk.
 * Suitable for OSS / on-premise / development deployments.
 */
import * as fs from "fs";
import * as path from "path";
import type { IOAuthTokenStore } from "../oauth-token.interfaces";

export class FileTokenStore implements IOAuthTokenStore {
  constructor(private readonly filePath: string) {}

  async get(provider: string): Promise<string | null> {
    const data = this.readFile();
    return data[provider] ?? null;
  }

  async save(provider: string, encrypted: string): Promise<void> {
    const data = this.readFile();
    data[provider] = encrypted;
    this.writeFile(data);
  }

  async delete(provider: string): Promise<void> {
    const data = this.readFile();
    delete data[provider];
    this.writeFile(data);
  }

  private readFile(): Record<string, string> {
    try {
      if (fs.existsSync(this.filePath)) {
        const content = fs.readFileSync(this.filePath, "utf8");
        return JSON.parse(content);
      }
    } catch {
      // Corrupted file — start fresh
    }
    return {};
  }

  private writeFile(data: Record<string, string>): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }
}

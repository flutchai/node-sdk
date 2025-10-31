import { randomBytes } from "crypto";
import type Redis from "ioredis";
import {
  CallbackEntry,
  CallbackRecord,
} from "../interfaces/callback.interface";

/**
 * CallbackStore manages callback tokens and their lifecycle.
 *
 * Production mode (NODE_ENV=production):
 * - Uses Lua scripts for atomic operations (better performance, guaranteed consistency)
 * - Prevents race conditions in high-concurrency scenarios
 * - Single network round-trip per operation
 *
 * Development mode (NODE_ENV!=production):
 * - Uses simple Redis operations for ioredis-mock compatibility
 * - Non-atomic operations (acceptable for development/testing)
 * - Better debugging and simpler error handling
 */
export class CallbackStore {
  private readonly isProduction: boolean;

  constructor(private readonly redis: Redis) {
    this.isProduction = process.env.NODE_ENV === "production";
  }

  private generateToken(graphType: string): string {
    // Use :: as separator since it's not used in base64url
    // Format: cb::{graphType}::{random}
    // 8 bytes = 64 bits of entropy, practically collision-free for short-lived tokens
    return `cb::${graphType}::${randomBytes(8).toString("base64url")}`;
  }

  /**
   * Issues a new callback token and persists its payload.
   */
  async issue(entry: CallbackEntry): Promise<string> {
    const token = this.generateToken(entry.graphType);
    const record: CallbackRecord = {
      ...entry,
      token,
      status: "pending",
      createdAt: Date.now(),
      retries: 0,
    };
    const ttl = entry.metadata?.ttlSec ?? 600; // default 10 minutes
    await this.redis.setex(`callback:${token}`, ttl, JSON.stringify(record));
    return token;
  }

  /**
   * Atomically fetches callback data and acquires a lock.
   */
  async getAndLock(token: string): Promise<CallbackRecord | null> {
    if (this.isProduction) {
      return this.getAndLockAtomic(token);
    } else {
      return this.getAndLockSimple(token);
    }
  }

  /**
   * Production version with Lua script for atomicity
   */
  private async getAndLockAtomic(
    token: string
  ): Promise<CallbackRecord | null> {
    const script = `
      local data = redis.call('GET', KEYS[1])
      if not data then return nil end
      local record = cjson.decode(data)
      if record.status ~= 'pending' then return nil end
      record.status = 'processing'
      redis.call('SET', KEYS[1], cjson.encode(record))
      return cjson.encode(record)
    `;
    const result = await this.redis.eval(script, 1, `callback:${token}`);
    return result ? (JSON.parse(result as string) as CallbackRecord) : null;
  }

  /**
   * Development version with simple operations for ioredis-mock compatibility
   */
  private async getAndLockSimple(
    token: string
  ): Promise<CallbackRecord | null> {
    const key = `callback:${token}`;
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    try {
      const record = JSON.parse(data) as CallbackRecord;

      if (record.status !== "pending") {
        return null;
      }

      // Update status to processing
      record.status = "processing";
      await this.redis.set(key, JSON.stringify(record));

      return record;
    } catch (error) {
      console.error("Failed to parse callback record:", error);
      return null;
    }
  }

  /**
   * Finalizes callback processing by removing token.
   */
  async finalize(token: string): Promise<void> {
    await this.redis.del(`callback:${token}`);
  }

  /**
   * Mark callback as failed and store error message.
   */
  async fail(token: string, error: string): Promise<CallbackRecord | null> {
    if (this.isProduction) {
      return this.failAtomic(token, error);
    } else {
      return this.failSimple(token, error);
    }
  }

  /**
   * Production version with Lua script for atomicity
   */
  private async failAtomic(
    token: string,
    error: string
  ): Promise<CallbackRecord | null> {
    const script = `
      local data = redis.call('GET', KEYS[1])
      if not data then return nil end
      local record = cjson.decode(data)
      record.status = 'failed'
      record.retries = (record.retries or 0) + 1
      record.lastError = ARGV[1]
      redis.call('SET', KEYS[1], cjson.encode(record))
      return cjson.encode(record)
    `;
    const result = await this.redis.eval(script, 1, `callback:${token}`, error);
    return result ? (JSON.parse(result as string) as CallbackRecord) : null;
  }

  /**
   * Development version with simple operations for ioredis-mock compatibility
   */
  private async failSimple(
    token: string,
    error: string
  ): Promise<CallbackRecord | null> {
    const key = `callback:${token}`;
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    try {
      const record = JSON.parse(data) as CallbackRecord;
      record.status = "failed";
      record.retries = (record.retries || 0) + 1;
      record.lastError = error;

      await this.redis.set(key, JSON.stringify(record));
      return record;
    } catch (parseError) {
      console.error("Failed to parse callback record:", parseError);
      return null;
    }
  }

  /**
   * Reset callback status to pending for retry.
   */
  async retry(token: string): Promise<CallbackRecord | null> {
    if (this.isProduction) {
      return this.retryAtomic(token);
    } else {
      return this.retrySimple(token);
    }
  }

  /**
   * Production version with Lua script for atomicity
   */
  private async retryAtomic(token: string): Promise<CallbackRecord | null> {
    const script = `
      local data = redis.call('GET', KEYS[1])
      if not data then return nil end
      local record = cjson.decode(data)
      record.status = 'pending'
      redis.call('SET', KEYS[1], cjson.encode(record))
      return cjson.encode(record)
    `;
    const result = await this.redis.eval(script, 1, `callback:${token}`);
    return result ? (JSON.parse(result as string) as CallbackRecord) : null;
  }

  /**
   * Development version with simple operations for ioredis-mock compatibility
   */
  private async retrySimple(token: string): Promise<CallbackRecord | null> {
    const key = `callback:${token}`;
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    try {
      const record = JSON.parse(data) as CallbackRecord;
      record.status = "pending";

      await this.redis.set(key, JSON.stringify(record));
      return record;
    } catch (parseError) {
      console.error("Failed to parse callback record:", parseError);
      return null;
    }
  }
}

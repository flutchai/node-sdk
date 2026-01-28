import type Redis from "ioredis";
import { CallbackEntry, CallbackRecord } from "./callback.interface";
import {
  generateCallbackToken,
  createCallbackRecord,
  resolveCallbackTTL,
  parseCallbackRecord,
  markAsFailed,
  markAsPending,
} from "./callback-store.logic";

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

  /**
   * Issues a new callback token and persists its payload.
   */
  async issue(entry: CallbackEntry): Promise<string> {
    const token = generateCallbackToken(entry.graphType);
    const record = createCallbackRecord(entry, token, Date.now());
    const ttl = resolveCallbackTTL(entry);
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
   * Production version: uses Redis Lua scripting for atomic get-and-lock.
   * NOTE: redis.eval() here executes a Lua script on the Redis server,
   * NOT JavaScript eval(). This is the standard ioredis API for Lua scripting.
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

    const record = parseCallbackRecord(data);
    if (!record) {
      console.error("Failed to parse callback record");
      return null;
    }

    if (record.status !== "pending") {
      return null;
    }

    // Update status to processing
    record.status = "processing";
    await this.redis.set(key, JSON.stringify(record));

    return record;
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
   * Production version: uses Redis Lua scripting for atomic fail.
   * NOTE: redis.eval() here executes a Lua script on the Redis server.
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

    const record = parseCallbackRecord(data);
    if (!record) {
      console.error("Failed to parse callback record");
      return null;
    }

    const updated = markAsFailed(record, error);
    await this.redis.set(key, JSON.stringify(updated));
    return updated;
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
   * Production version: uses Redis Lua scripting for atomic retry.
   * NOTE: redis.eval() here executes a Lua script on the Redis server.
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

    const record = parseCallbackRecord(data);
    if (!record) {
      console.error("Failed to parse callback record");
      return null;
    }

    const updated = markAsPending(record);
    await this.redis.set(key, JSON.stringify(updated));
    return updated;
  }
}

import { Injectable, Logger } from "@nestjs/common";
import type Redis from "ioredis";
import { createHash } from "crypto";
import { CallbackResult } from "./callback.interface";

export interface IdempotencyConfig {
  ttlSeconds: number; // How long to cache results
  keyPrefix: string; // Redis key prefix
  hashPayload: boolean; // Whether to hash the payload for key generation
  includeUserId: boolean; // Include userId in idempotency key
}

export interface IdempotencyEntry {
  key: string;
  result: CallbackResult;
  createdAt: number;
  executedAt: number;
  expiresAt: number;
  requestHash: string;
  attempts: number;
}

export enum IdempotencyStatus {
  NEW = "NEW",
  IN_PROGRESS = "IN_PROGRESS",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
}

/**
 * Manages idempotent callback execution to prevent duplicate operations.
 * Caches results and ensures exactly-once execution semantics.
 */
@Injectable()
export class IdempotencyManager {
  private readonly logger = new Logger(IdempotencyManager.name);
  private readonly defaultConfig: IdempotencyConfig = {
    ttlSeconds: 3600, // 1 hour default
    keyPrefix: "idempotency",
    hashPayload: true,
    includeUserId: true,
  };

  constructor(private readonly redis: Redis) {}

  /**
   * Check if a request is idempotent and return cached result if available.
   * If not, acquire a lock for execution.
   */
  async checkAndLock(
    idempotencyKey: string | undefined,
    requestData: {
      userId?: string;
      graphType: string;
      handler: string;
      params: Record<string, any>;
    },
    config?: Partial<IdempotencyConfig>
  ): Promise<{
    status: IdempotencyStatus;
    result?: CallbackResult;
    key: string;
  }> {
    const cfg = { ...this.defaultConfig, ...config };

    // Generate idempotency key if not provided
    const key = idempotencyKey || this.generateKey(requestData, cfg);
    const redisKey = `${cfg.keyPrefix}:${key}`;

    // Try to get existing result
    const existing = await this.redis.get(redisKey);
    if (existing) {
      try {
        const entry: IdempotencyEntry = JSON.parse(existing);

        // Check if it's still being processed
        if (entry.result === null && entry.executedAt === 0) {
          // Check if it's stuck (processing for more than 5 minutes)
          const processingTime = Date.now() - entry.createdAt;
          if (processingTime > 300000) {
            // Reset stuck entry
            await this.redis.del(redisKey);
          } else {
            return {
              status: IdempotencyStatus.IN_PROGRESS,
              key,
            };
          }
        }

        // Return cached result
        this.logger.debug(
          `Returning cached result for idempotency key: ${key}`
        );
        return {
          status: IdempotencyStatus.COMPLETED,
          result: entry.result,
          key,
        };
      } catch (error) {
        this.logger.error(
          `Failed to parse idempotency entry: ${error.message}`
        );
        await this.redis.del(redisKey);
      }
    }

    // Try to acquire lock for new execution
    const lockAcquired = await this.acquireLock(redisKey, cfg.ttlSeconds);
    if (!lockAcquired) {
      // Someone else is processing
      return {
        status: IdempotencyStatus.IN_PROGRESS,
        key,
      };
    }

    return {
      status: IdempotencyStatus.NEW,
      key,
    };
  }

  /**
   * Store the result of an idempotent operation.
   */
  async storeResult(
    key: string,
    result: CallbackResult,
    config?: Partial<IdempotencyConfig>
  ): Promise<void> {
    const cfg = { ...this.defaultConfig, ...config };
    const redisKey = `${cfg.keyPrefix}:${key}`;

    const entry: IdempotencyEntry = {
      key,
      result,
      createdAt: Date.now(),
      executedAt: Date.now(),
      expiresAt: Date.now() + cfg.ttlSeconds * 1000,
      requestHash: "",
      attempts: 1,
    };

    await this.redis.setex(redisKey, cfg.ttlSeconds, JSON.stringify(entry));

    this.logger.debug(`Stored idempotent result for key: ${key}`);
  }

  /**
   * Mark an idempotent operation as failed.
   */
  async markFailed(
    key: string,
    error: string,
    config?: Partial<IdempotencyConfig>
  ): Promise<void> {
    const cfg = { ...this.defaultConfig, ...config };
    const redisKey = `${cfg.keyPrefix}:${key}`;

    // Store failure with shorter TTL (5 minutes)
    const entry: IdempotencyEntry = {
      key,
      result: {
        success: false,
        error,
      },
      createdAt: Date.now(),
      executedAt: Date.now(),
      expiresAt: Date.now() + 300000, // 5 minutes
      requestHash: "",
      attempts: 1,
    };

    await this.redis.setex(
      redisKey,
      300, // 5 minutes TTL for failures
      JSON.stringify(entry)
    );

    this.logger.debug(`Marked idempotent operation as failed for key: ${key}`);
  }

  /**
   * Release lock if operation fails unexpectedly.
   */
  async releaseLock(
    key: string,
    config?: Partial<IdempotencyConfig>
  ): Promise<void> {
    const cfg = { ...this.defaultConfig, ...config };
    const redisKey = `${cfg.keyPrefix}:${key}`;
    await this.redis.del(redisKey);
    this.logger.debug(`Released lock for key: ${key}`);
  }

  /**
   * Generate idempotency key from request data.
   */
  private generateKey(
    requestData: {
      userId?: string;
      graphType: string;
      handler: string;
      params: Record<string, any>;
    },
    config: IdempotencyConfig
  ): string {
    const components: string[] = [requestData.graphType, requestData.handler];

    if (config.includeUserId && requestData.userId) {
      components.push(requestData.userId);
    }

    // Create deterministic string from params
    const paramsStr = this.deterministicStringify(requestData.params);

    if (config.hashPayload) {
      // Hash the params for shorter key
      const hash = createHash("sha256")
        .update(paramsStr)
        .digest("hex")
        .substring(0, 16);
      components.push(hash);
    } else {
      components.push(paramsStr);
    }

    return components.join(":");
  }

  /**
   * Acquire lock for idempotent operation.
   */
  private async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    // Create lock entry
    const entry: IdempotencyEntry = {
      key,
      result: null as any,
      createdAt: Date.now(),
      executedAt: 0,
      expiresAt: Date.now() + ttlSeconds * 1000,
      requestHash: "",
      attempts: 1,
    };

    // SET NX - only set if not exists
    const result = await this.redis.set(
      key,
      JSON.stringify(entry),
      "EX",
      ttlSeconds,
      "NX"
    );

    return result === "OK";
  }

  /**
   * Create deterministic JSON stringify (sorted keys).
   */
  private deterministicStringify(obj: any): string {
    return JSON.stringify(this.sortObject(obj));
  }

  /**
   * Recursively sort object keys for deterministic stringification.
   */
  private sortObject(obj: any): any {
    if (obj === null || typeof obj !== "object") {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sortObject(item));
    }

    const sorted: Record<string, any> = {};
    Object.keys(obj)
      .sort()
      .forEach(key => {
        sorted[key] = this.sortObject(obj[key]);
      });

    return sorted;
  }

  /**
   * Clean up expired idempotency entries.
   */
  async cleanup(): Promise<number> {
    const pattern = `${this.defaultConfig.keyPrefix}:*`;
    const keys = await this.redis.keys(pattern);
    let cleaned = 0;

    for (const key of keys) {
      const value = await this.redis.get(key);
      if (value) {
        try {
          const entry: IdempotencyEntry = JSON.parse(value);
          if (entry.expiresAt < Date.now()) {
            await this.redis.del(key);
            cleaned++;
          }
        } catch {
          // Invalid entry, delete it
          await this.redis.del(key);
          cleaned++;
        }
      }
    }

    this.logger.log(`Cleaned up ${cleaned} expired idempotency entries`);
    return cleaned;
  }

  /**
   * Get statistics about idempotency cache.
   */
  async getStatistics(): Promise<{
    totalEntries: number;
    completedEntries: number;
    inProgressEntries: number;
    failedEntries: number;
    cacheHitRate: number;
  }> {
    const pattern = `${this.defaultConfig.keyPrefix}:*`;
    const keys = await this.redis.keys(pattern);

    let completed = 0;
    let inProgress = 0;
    let failed = 0;

    for (const key of keys) {
      const value = await this.redis.get(key);
      if (value) {
        try {
          const entry: IdempotencyEntry = JSON.parse(value);
          if (entry.result === null) {
            inProgress++;
          } else if (entry.result.success === false) {
            failed++;
          } else {
            completed++;
          }
        } catch {
          // Skip invalid entries
        }
      }
    }

    const total = completed + inProgress + failed;
    const cacheHitRate = total > 0 ? (completed / total) * 100 : 0;

    return {
      totalEntries: total,
      completedEntries: completed,
      inProgressEntries: inProgress,
      failedEntries: failed,
      cacheHitRate,
    };
  }
}

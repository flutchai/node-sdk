import { Injectable, Logger } from "@nestjs/common";
import type Redis from "ioredis";

export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
  keyPrefix?: string; // Redis key prefix
  skipFailedRequests?: boolean; // Don't count failed requests
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

/**
 * Rate limiter for callback execution using sliding window algorithm.
 * Prevents abuse and protects against brute force attacks.
 */
@Injectable()
export class CallbackRateLimiter {
  private readonly logger = new Logger(CallbackRateLimiter.name);
  private readonly defaultConfig: RateLimitConfig = {
    windowMs: 60000, // 1 minute
    maxRequests: 10, // 10 requests per minute
    keyPrefix: "ratelimit:callback",
    skipFailedRequests: false,
  };

  constructor(private readonly redis: Redis) {}

  /**
   * Check if request is allowed based on rate limit.
   */
  async checkLimit(
    identifier: string,
    config?: Partial<RateLimitConfig>
  ): Promise<RateLimitResult> {
    const cfg = { ...this.defaultConfig, ...config };
    const key = `${cfg.keyPrefix}:${identifier}`;
    const now = Date.now();
    const windowStart = now - cfg.windowMs;

    // Use Lua script for atomic operation
    const script = `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local window_start = tonumber(ARGV[2])
      local max_requests = tonumber(ARGV[3])
      local window_ms = tonumber(ARGV[4])
      
      -- Remove old entries outside the window
      redis.call('ZREMRANGEBYSCORE', key, 0, window_start)
      
      -- Count requests in current window
      local current_requests = redis.call('ZCARD', key)
      
      if current_requests < max_requests then
        -- Add current request
        redis.call('ZADD', key, now, now)
        -- Set expiry
        redis.call('EXPIRE', key, math.ceil(window_ms / 1000))
        
        return {1, max_requests, max_requests - current_requests - 1, 0}
      else
        -- Get oldest request in window to calculate retry time
        local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
        local reset_at = oldest[2] and (tonumber(oldest[2]) + window_ms) or (now + window_ms)
        
        return {0, max_requests, 0, reset_at}
      end
    `;

    const result = (await this.redis.eval(
      script,
      1,
      key,
      now,
      windowStart,
      cfg.maxRequests,
      cfg.windowMs
    )) as [number, number, number, number];

    const [allowed, limit, remaining, resetAt] = result;

    const rateLimitResult: RateLimitResult = {
      allowed: allowed === 1,
      limit,
      remaining: Math.max(0, remaining),
      resetAt,
    };

    if (!rateLimitResult.allowed) {
      rateLimitResult.retryAfter = Math.ceil((resetAt - now) / 1000);
      this.logger.warn(
        `Rate limit exceeded for ${identifier}. Retry after ${rateLimitResult.retryAfter}s`
      );
    }

    return rateLimitResult;
  }

  /**
   * Check rate limit for user-specific operations.
   */
  async checkUserLimit(
    userId: string,
    config?: Partial<RateLimitConfig>
  ): Promise<RateLimitResult> {
    return this.checkLimit(`user:${userId}`, {
      windowMs: 60000, // 1 minute
      maxRequests: 20, // 20 requests per minute per user
      ...config,
    });
  }

  /**
   * Check rate limit for IP-based operations.
   */
  async checkIpLimit(
    ip: string,
    config?: Partial<RateLimitConfig>
  ): Promise<RateLimitResult> {
    return this.checkLimit(`ip:${ip}`, {
      windowMs: 60000, // 1 minute
      maxRequests: 30, // 30 requests per minute per IP
      ...config,
    });
  }

  /**
   * Check rate limit for token validation attempts (stricter).
   */
  async checkTokenLimit(
    identifier: string,
    config?: Partial<RateLimitConfig>
  ): Promise<RateLimitResult> {
    return this.checkLimit(`token:${identifier}`, {
      windowMs: 300000, // 5 minutes
      maxRequests: 5, // 5 attempts per 5 minutes
      ...config,
    });
  }

  /**
   * Reset rate limit for an identifier.
   * Useful for admin operations or testing.
   */
  async reset(identifier: string, keyPrefix?: string): Promise<void> {
    const prefix = keyPrefix || this.defaultConfig.keyPrefix;
    const key = `${prefix}:${identifier}`;
    await this.redis.del(key);
    this.logger.debug(`Rate limit reset for ${identifier}`);
  }

  /**
   * Get current rate limit status without incrementing counter.
   */
  async getStatus(
    identifier: string,
    config?: Partial<RateLimitConfig>
  ): Promise<RateLimitResult> {
    const cfg = { ...this.defaultConfig, ...config };
    const key = `${cfg.keyPrefix}:${identifier}`;
    const now = Date.now();
    const windowStart = now - cfg.windowMs;

    // Remove old entries and count current
    await this.redis.zremrangebyscore(key, 0, windowStart);
    const currentRequests = await this.redis.zcard(key);

    const remaining = Math.max(0, cfg.maxRequests - currentRequests);
    const allowed = currentRequests < cfg.maxRequests;

    let resetAt = now + cfg.windowMs;
    if (!allowed) {
      const oldest = await this.redis.zrange(key, 0, 0, "WITHSCORES");
      if (oldest.length >= 2) {
        resetAt = parseInt(oldest[1]) + cfg.windowMs;
      }
    }

    return {
      allowed,
      limit: cfg.maxRequests,
      remaining,
      resetAt,
      retryAfter: allowed ? undefined : Math.ceil((resetAt - now) / 1000),
    };
  }

  /**
   * Create rate limit headers for HTTP response.
   */
  createHeaders(result: RateLimitResult): Record<string, string> {
    const headers: Record<string, string> = {
      "X-RateLimit-Limit": result.limit.toString(),
      "X-RateLimit-Remaining": result.remaining.toString(),
      "X-RateLimit-Reset": new Date(result.resetAt).toISOString(),
    };

    if (result.retryAfter) {
      headers["Retry-After"] = result.retryAfter.toString();
    }

    return headers;
  }
}

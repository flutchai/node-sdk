import { Injectable, Logger } from "@nestjs/common";
import { CallbackRegistry } from "./callback-registry";
import {
  CallbackRecord,
  CallbackResult,
} from "../interfaces/callback.interface";
import { CallbackStore } from "./callback-store";
import { CallbackACL, CallbackUser } from "./callback-acl.service";
import { CallbackAuditor } from "./callback-auditor.service";
import { CallbackMetrics } from "./callback-metrics.service";
import { CallbackRateLimiter } from "./callback-rate-limiter";
import { IdempotencyManager, IdempotencyStatus } from "./idempotency-manager";
import { CallbackPatchService } from "./callback-patch.service";

export interface RouterConfig {
  maxRetries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  enableCircuitBreaker?: boolean;
  circuitBreakerThreshold?: number;
  circuitBreakerResetMs?: number;
}

interface CircuitBreakerState {
  failures: number;
  lastFailure?: number;
  state: "closed" | "open" | "half-open";
}

/**
 * Enhanced Smart Callback Router with error handling, retry logic,
 * circuit breaker pattern, and comprehensive monitoring.
 */
@Injectable()
export class SmartCallbackRouter {
  private readonly logger = new Logger(SmartCallbackRouter.name);
  private readonly circuitBreakers = new Map<string, CircuitBreakerState>();
  private readonly defaultConfig: RouterConfig = {
    maxRetries: 3,
    retryDelayMs: 1000,
    timeoutMs: 30000,
    enableCircuitBreaker: true,
    circuitBreakerThreshold: 5,
    circuitBreakerResetMs: 60000,
  };

  constructor(
    private readonly registry: CallbackRegistry,
    private readonly store: CallbackStore,
    private readonly acl: CallbackACL,
    private readonly auditor: CallbackAuditor,
    private readonly metrics: CallbackMetrics,
    private readonly rateLimiter: CallbackRateLimiter,
    private readonly idempotencyManager: IdempotencyManager,
    private readonly patchService: CallbackPatchService
  ) {}

  /**
   * Route and execute callback with full error handling and monitoring.
   */
  async route(
    record: CallbackRecord,
    user: CallbackUser | undefined,
    requestMetadata?: {
      ip?: string;
      userAgent?: string;
      platform?: string;
      platformContext?: any;
    },
    config?: RouterConfig
  ): Promise<CallbackResult> {
    const cfg = { ...this.defaultConfig, ...config };
    const startTime = Date.now();
    const correlationId = await this.auditor.logExecutionStart(record, user);
    let idempotencyCheck: any = null;

    try {
      // 1. Check idempotency first
      const idempotencyKey = record.metadata?.idempotencyKey;
      idempotencyCheck = await this.idempotencyManager.checkAndLock(
        idempotencyKey,
        {
          userId: record.userId,
          graphType: record.graphType,
          handler: record.handler,
          params: record.params,
        }
      );

      // Return cached result if already executed
      if (idempotencyCheck.status === IdempotencyStatus.COMPLETED) {
        this.logger.debug(`Returning cached result for ${record.token}`);
        return idempotencyCheck.result!;
      }

      // Wait if already in progress
      if (idempotencyCheck.status === IdempotencyStatus.IN_PROGRESS) {
        throw new Error("Request is already being processed");
      }

      // 2. Check rate limits
      await this.checkRateLimits(user, requestMetadata?.ip);

      // ACL permissions already validated by CallbackTokenGuard
      // No need to validate again here

      // 3. Record token age
      const tokenAge = Date.now() - record.createdAt;
      this.metrics.recordTokenAge(record.graphType, tokenAge);

      // 4. Check circuit breaker
      this.checkCircuitBreaker(record.graphType, record.handler);

      // 5. Start execution
      this.metrics.recordExecutionStart(record.graphType, record.handler);

      // 6. Execute with timeout and retry
      const result = await this.executeWithRetry(
        record,
        user,
        cfg,
        correlationId
      );

      // 7. Record success
      const duration = Date.now() - startTime;
      await this.auditor.logExecutionSuccess(
        record,
        user,
        result,
        duration,
        correlationId
      );
      this.metrics.recordExecutionComplete(
        record.graphType,
        record.handler,
        duration,
        true
      );

      // 8. Reset circuit breaker on success
      this.resetCircuitBreaker(record.graphType, record.handler);

      // 9. Store idempotent result
      await this.idempotencyManager.storeResult(idempotencyCheck.key, result);

      // 10. Finalize token
      await this.store.finalize(record.token);

      // 11. Apply patch if provided
      if (result.patch) {
        await this.patchService.apply(
          record,
          result.patch,
          requestMetadata?.platformContext
        );
      }

      return result;
    } catch (error) {
      // Record failure
      const duration = Date.now() - startTime;
      await this.auditor.logExecutionFailure(
        record,
        user,
        error,
        duration,
        correlationId
      );
      this.metrics.recordExecutionComplete(
        record.graphType,
        record.handler,
        duration,
        false,
        error.message
      );

      // Update circuit breaker
      this.recordCircuitBreakerFailure(record.graphType, record.handler);

      // Mark idempotency as failed
      if (idempotencyCheck) {
        await this.idempotencyManager.markFailed(
          idempotencyCheck.key,
          error.message
        );
      }

      // Mark token as failed
      await this.store.fail(record.token, error.message);

      throw error;
    }
  }

  /**
   * Execute callback with retry logic.
   */
  private async executeWithRetry(
    record: CallbackRecord,
    user: CallbackUser | undefined,
    config: RouterConfig,
    correlationId: string
  ): Promise<CallbackResult> {
    let lastError: Error;

    for (let attempt = 1; attempt <= config.maxRetries!; attempt++) {
      try {
        if (attempt > 1) {
          // Log retry attempt
          await this.auditor.logRetryAttempt(record, user, attempt);
          this.metrics.recordRetry(record.graphType, record.handler);

          // Wait before retry with exponential backoff
          const delay = config.retryDelayMs! * Math.pow(2, attempt - 2);
          await this.sleep(delay);
        }

        // Execute with timeout
        return await this.executeWithTimeout(record, config.timeoutMs!);
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `[${correlationId}] Attempt ${attempt}/${config.maxRetries} failed: ${error.message}`
        );

        // Don't retry on certain errors
        if (this.isNonRetryableError(error)) {
          throw error;
        }
      }
    }

    throw new Error(
      `Callback execution failed after ${config.maxRetries} attempts: ${lastError!.message}`
    );
  }

  /**
   * Execute callback with timeout.
   */
  private async executeWithTimeout(
    record: CallbackRecord,
    timeoutMs: number
  ): Promise<CallbackResult> {
    const handler = this.registry.get(record.handler, record.graphType);
    if (!handler) {
      throw new Error(
        `No callback handler registered for ${record.handler} (graphType: ${record.graphType})`
      );
    }

    return Promise.race([
      handler({
        userId: record.userId,
        threadId: record.threadId,
        agentId: record.agentId,
        params: record.params,
        platform: record.metadata?.platform,
        metadata: record.metadata,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(`Callback execution timeout after ${timeoutMs}ms`)
            ),
          timeoutMs
        )
      ),
    ]);
  }

  /**
   * Check rate limits for user and IP.
   */
  private async checkRateLimits(
    user: CallbackUser | undefined,
    ip?: string
  ): Promise<void> {
    // Check user rate limit
    if (user) {
      const userLimit = await this.rateLimiter.checkUserLimit(user.userId);
      if (!userLimit.allowed) {
        this.metrics.recordRateLimited("user");
        await this.auditor.logRateLimited(
          `user:${user.userId}`,
          userLimit.retryAfter!
        );
        throw new Error(
          `Rate limit exceeded. Retry after ${userLimit.retryAfter} seconds`
        );
      }
    }

    // Check IP rate limit
    if (ip) {
      const ipLimit = await this.rateLimiter.checkIpLimit(ip);
      if (!ipLimit.allowed) {
        this.metrics.recordRateLimited("ip");
        await this.auditor.logRateLimited(`ip:${ip}`, ipLimit.retryAfter!);
        throw new Error(
          `Rate limit exceeded. Retry after ${ipLimit.retryAfter} seconds`
        );
      }
    }
  }

  /**
   * Check circuit breaker state.
   */
  private checkCircuitBreaker(graphType: string, handler: string): void {
    const key = `${graphType}::${handler}`;
    const breaker = this.circuitBreakers.get(key);

    if (!breaker) return;

    if (breaker.state === "open") {
      const now = Date.now();
      const resetTime =
        breaker.lastFailure! + this.defaultConfig.circuitBreakerResetMs!;

      if (now < resetTime) {
        throw new Error(
          `Circuit breaker is open for ${key}. Service temporarily unavailable.`
        );
      } else {
        // Move to half-open state
        breaker.state = "half-open";
      }
    }
  }

  /**
   * Record circuit breaker failure.
   */
  private recordCircuitBreakerFailure(
    graphType: string,
    handler: string
  ): void {
    const key = `${graphType}::${handler}`;
    const breaker = this.circuitBreakers.get(key) || {
      failures: 0,
      state: "closed",
    };

    breaker.failures++;
    breaker.lastFailure = Date.now();

    if (breaker.failures >= this.defaultConfig.circuitBreakerThreshold!) {
      breaker.state = "open";
      this.logger.error(
        `Circuit breaker opened for ${key} after ${breaker.failures} failures`
      );
    }

    this.circuitBreakers.set(key, breaker);
  }

  /**
   * Reset circuit breaker on success.
   */
  private resetCircuitBreaker(graphType: string, handler: string): void {
    const key = `${graphType}::${handler}`;
    this.circuitBreakers.delete(key);
  }

  /**
   * Check if error is non-retryable.
   */
  private isNonRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes("forbidden") ||
      message.includes("unauthorized") ||
      message.includes("invalid token") ||
      message.includes("expired") ||
      message.includes("rate limit")
    );
  }

  /**
   * Sleep helper for retry delays.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get circuit breaker status.
   */
  getCircuitBreakerStatus(): Map<string, CircuitBreakerState> {
    return new Map(this.circuitBreakers);
  }
}

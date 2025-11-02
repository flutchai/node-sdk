import { Injectable, Logger } from "@nestjs/common";
import { CallbackRecord, CallbackResult } from "./callback.interface";
import { CallbackUser } from "./callback-acl.service";
import { randomUUID } from "crypto";

export interface AuditEntry {
  id: string;
  correlationId: string;
  timestamp: number;
  action: CallbackAuditAction;
  userId?: string;
  callbackToken: string;
  graphType: string;
  handler: string;
  success: boolean;
  duration?: number;
  error?: string;
  metadata: Record<string, any>;
  ip?: string;
  userAgent?: string;
}

export enum CallbackAuditAction {
  TOKEN_ISSUED = "TOKEN_ISSUED",
  TOKEN_VALIDATED = "TOKEN_VALIDATED",
  TOKEN_LOCKED = "TOKEN_LOCKED",
  EXECUTION_STARTED = "EXECUTION_STARTED",
  EXECUTION_COMPLETED = "EXECUTION_COMPLETED",
  EXECUTION_FAILED = "EXECUTION_FAILED",
  TOKEN_EXPIRED = "TOKEN_EXPIRED",
  ACCESS_DENIED = "ACCESS_DENIED",
  RATE_LIMITED = "RATE_LIMITED",
  RETRY_ATTEMPTED = "RETRY_ATTEMPTED",
}

/**
 * Auditor service for callback operations.
 * Logs all callback-related activities for compliance and debugging.
 */
@Injectable()
export class CallbackAuditor {
  private readonly logger = new Logger(CallbackAuditor.name);
  private readonly auditStore: Map<string, AuditEntry> = new Map();

  /**
   * Log callback token issuance.
   */
  async logTokenIssued(
    token: string,
    graphType: string,
    handler: string,
    userId: string,
    metadata?: Record<string, any>
  ): Promise<string> {
    const correlationId = this.generateCorrelationId();
    const entry: AuditEntry = {
      id: randomUUID(),
      correlationId,
      timestamp: Date.now(),
      action: CallbackAuditAction.TOKEN_ISSUED,
      userId,
      callbackToken: token,
      graphType,
      handler,
      success: true,
      metadata: {
        ...metadata,
        ttl: metadata?.ttlSec,
        scopes: metadata?.scopes,
      },
    };

    await this.persist(entry);
    this.logger.log(
      `[${correlationId}] Token issued: ${token} for ${graphType}::${handler} by user ${userId}`
    );

    return correlationId;
  }

  /**
   * Log callback execution start.
   */
  async logExecutionStart(
    record: CallbackRecord,
    user: CallbackUser | undefined,
    correlationId?: string
  ): Promise<string> {
    const corrId = correlationId || this.generateCorrelationId();
    const entry: AuditEntry = {
      id: randomUUID(),
      correlationId: corrId,
      timestamp: Date.now(),
      action: CallbackAuditAction.EXECUTION_STARTED,
      userId: user?.userId,
      callbackToken: record.token,
      graphType: record.graphType,
      handler: record.handler,
      success: true,
      metadata: {
        originalUserId: record.userId,
        retries: record.retries,
        age: Date.now() - record.createdAt,
      },
    };

    await this.persist(entry);
    this.logger.log(
      `[${corrId}] Execution started: ${record.graphType}::${record.handler} by user ${user?.userId}`
    );

    return corrId;
  }

  /**
   * Log successful callback execution.
   */
  async logExecutionSuccess(
    record: CallbackRecord,
    user: CallbackUser | undefined,
    result: CallbackResult,
    duration: number,
    correlationId: string
  ): Promise<void> {
    const entry: AuditEntry = {
      id: randomUUID(),
      correlationId,
      timestamp: Date.now(),
      action: CallbackAuditAction.EXECUTION_COMPLETED,
      userId: user?.userId,
      callbackToken: record.token,
      graphType: record.graphType,
      handler: record.handler,
      success: true,
      duration,
      metadata: {
        hasAttachments: !!result.attachments?.length,
        hasPatch: !!result.patch,
        message: result.message,
      },
    };

    await this.persist(entry);
    this.logger.log(
      `[${correlationId}] Execution completed: ${record.graphType}::${record.handler} ` +
        `in ${duration}ms`
    );
  }

  /**
   * Log failed callback execution.
   */
  async logExecutionFailure(
    record: CallbackRecord,
    user: CallbackUser | undefined,
    error: Error,
    duration: number,
    correlationId: string
  ): Promise<void> {
    const entry: AuditEntry = {
      id: randomUUID(),
      correlationId,
      timestamp: Date.now(),
      action: CallbackAuditAction.EXECUTION_FAILED,
      userId: user?.userId,
      callbackToken: record.token,
      graphType: record.graphType,
      handler: record.handler,
      success: false,
      duration,
      error: error.message,
      metadata: {
        errorName: error.name,
        errorStack: error.stack,
        retries: record.retries,
      },
    };

    await this.persist(entry);
    this.logger.error(
      `[${correlationId}] Execution failed: ${record.graphType}::${record.handler} - ${error.message}`,
      error.stack
    );
  }

  /**
   * Log access denied event.
   */
  async logAccessDenied(
    token: string,
    userId?: string,
    reason?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    const correlationId = this.generateCorrelationId();
    const entry: AuditEntry = {
      id: randomUUID(),
      correlationId,
      timestamp: Date.now(),
      action: CallbackAuditAction.ACCESS_DENIED,
      userId,
      callbackToken: token,
      graphType: metadata?.graphType || "unknown",
      handler: metadata?.handler || "unknown",
      success: false,
      error: reason,
      metadata: metadata || {},
    };

    await this.persist(entry);
    this.logger.warn(
      `[${correlationId}] Access denied for token ${token}: ${reason}`
    );
  }

  /**
   * Log rate limit exceeded event.
   */
  async logRateLimited(
    identifier: string,
    retryAfter: number,
    metadata?: Record<string, any>
  ): Promise<void> {
    const correlationId = this.generateCorrelationId();
    const entry: AuditEntry = {
      id: randomUUID(),
      correlationId,
      timestamp: Date.now(),
      action: CallbackAuditAction.RATE_LIMITED,
      callbackToken: metadata?.token || "unknown",
      graphType: metadata?.graphType || "unknown",
      handler: metadata?.handler || "unknown",
      success: false,
      metadata: {
        identifier,
        retryAfter,
        ...metadata,
      },
    };

    await this.persist(entry);
    this.logger.warn(
      `[${correlationId}] Rate limited: ${identifier}, retry after ${retryAfter}s`
    );
  }

  /**
   * Log retry attempt.
   */
  async logRetryAttempt(
    record: CallbackRecord,
    user: CallbackUser | undefined,
    attemptNumber: number
  ): Promise<string> {
    const correlationId = this.generateCorrelationId();
    const entry: AuditEntry = {
      id: randomUUID(),
      correlationId,
      timestamp: Date.now(),
      action: CallbackAuditAction.RETRY_ATTEMPTED,
      userId: user?.userId,
      callbackToken: record.token,
      graphType: record.graphType,
      handler: record.handler,
      success: true,
      metadata: {
        attemptNumber,
        totalRetries: record.retries,
        lastError: record.lastError,
      },
    };

    await this.persist(entry);
    this.logger.log(
      `[${correlationId}] Retry attempt #${attemptNumber} for ${record.graphType}::${record.handler}`
    );

    return correlationId;
  }

  /**
   * Get audit trail for a specific token.
   */
  async getTokenAuditTrail(token: string): Promise<AuditEntry[]> {
    const entries: AuditEntry[] = [];
    for (const entry of this.auditStore.values()) {
      if (entry.callbackToken === token) {
        entries.push(entry);
      }
    }
    return entries.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get audit trail for a specific user.
   */
  async getUserAuditTrail(
    userId: string,
    startTime?: number,
    endTime?: number
  ): Promise<AuditEntry[]> {
    const entries: AuditEntry[] = [];
    const start = startTime || 0;
    const end = endTime || Date.now();

    for (const entry of this.auditStore.values()) {
      if (
        entry.userId === userId &&
        entry.timestamp >= start &&
        entry.timestamp <= end
      ) {
        entries.push(entry);
      }
    }
    return entries.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get audit statistics for reporting.
   */
  async getStatistics(
    startTime: number,
    endTime: number
  ): Promise<Record<string, any>> {
    const entries: AuditEntry[] = [];
    for (const entry of this.auditStore.values()) {
      if (entry.timestamp >= startTime && entry.timestamp <= endTime) {
        entries.push(entry);
      }
    }

    const stats = {
      totalCallbacks: entries.length,
      successfulExecutions: entries.filter(
        e => e.action === CallbackAuditAction.EXECUTION_COMPLETED
      ).length,
      failedExecutions: entries.filter(
        e => e.action === CallbackAuditAction.EXECUTION_FAILED
      ).length,
      accessDenied: entries.filter(
        e => e.action === CallbackAuditAction.ACCESS_DENIED
      ).length,
      rateLimited: entries.filter(
        e => e.action === CallbackAuditAction.RATE_LIMITED
      ).length,
      averageDuration: 0,
      byGraphType: {} as Record<string, number>,
      byHandler: {} as Record<string, number>,
    };

    // Calculate average duration
    const durations = entries.filter(e => e.duration).map(e => e.duration!);
    if (durations.length > 0) {
      stats.averageDuration =
        durations.reduce((a, b) => a + b, 0) / durations.length;
    }

    // Group by graph type and handler
    entries.forEach(entry => {
      stats.byGraphType[entry.graphType] =
        (stats.byGraphType[entry.graphType] || 0) + 1;
      const key = `${entry.graphType}::${entry.handler}`;
      stats.byHandler[key] = (stats.byHandler[key] || 0) + 1;
    });

    return stats;
  }

  /**
   * Persist audit entry.
   * In production, this should write to a persistent store (DB, S3, etc.)
   */
  private async persist(entry: AuditEntry): Promise<void> {
    // For now, store in memory. In production, write to database or audit log service
    this.auditStore.set(entry.id, entry);

    // Clean up old entries (keep last 10000)
    if (this.auditStore.size > 10000) {
      const entries = Array.from(this.auditStore.entries())
        .sort((a, b) => b[1].timestamp - a[1].timestamp)
        .slice(0, 10000);
      this.auditStore.clear();
      entries.forEach(([id, entry]) => this.auditStore.set(id, entry));
    }

    // In production, also send to external audit service
    // await this.sendToAuditService(entry);
  }

  /**
   * Generate correlation ID for tracking related events.
   */
  private generateCorrelationId(): string {
    return `cb_${Date.now()}_${randomUUID().slice(0, 8)}`;
  }

  /**
   * Export audit logs for compliance.
   */
  async exportAuditLogs(
    startTime: number,
    endTime: number,
    format: "json" | "csv" = "json"
  ): Promise<string> {
    const entries: AuditEntry[] = [];
    for (const entry of this.auditStore.values()) {
      if (entry.timestamp >= startTime && entry.timestamp <= endTime) {
        entries.push(entry);
      }
    }

    if (format === "json") {
      return JSON.stringify(entries, null, 2);
    } else {
      // CSV format
      const headers = [
        "id",
        "correlationId",
        "timestamp",
        "action",
        "userId",
        "callbackToken",
        "graphType",
        "handler",
        "success",
        "duration",
        "error",
      ];
      const rows = entries.map(e => [
        e.id,
        e.correlationId,
        new Date(e.timestamp).toISOString(),
        e.action,
        e.userId || "",
        e.callbackToken,
        e.graphType,
        e.handler,
        e.success.toString(),
        e.duration?.toString() || "",
        e.error || "",
      ]);
      return [headers, ...rows].map(row => row.join(",")).join("\n");
    }
  }
}

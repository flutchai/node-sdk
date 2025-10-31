import { Injectable } from "@nestjs/common";
import {
  Counter,
  Histogram,
  Gauge,
  Registry,
  collectDefaultMetrics,
} from "prom-client";

/**
 * Prometheus metrics for callback system monitoring.
 */
@Injectable()
export class CallbackMetrics {
  private readonly registry: Registry;

  // Counters
  private readonly callbacksTotal: Counter;
  private readonly callbacksSuccess: Counter;
  private readonly callbacksFailed: Counter;
  private readonly callbacksRetried: Counter;
  private readonly accessDenied: Counter;
  private readonly rateLimited: Counter;
  private readonly tokensIssued: Counter;
  private readonly tokensExpired: Counter;

  // Histograms
  private readonly executionDuration: Histogram;
  private readonly aclValidationDuration: Histogram;
  private readonly tokenAge: Histogram;

  // Gauges
  private readonly activeCallbacks: Gauge;
  private readonly pendingCallbacks: Gauge;
  private readonly queueSize: Gauge;

  constructor(registry?: Registry) {
    this.registry = registry ?? new Registry();

    // Collect default Node.js metrics
    collectDefaultMetrics({ register: this.registry });

    // Initialize counters
    this.callbacksTotal = new Counter({
      name: "graph_callbacks_total",
      help: "Total number of callback executions",
      labelNames: ["graph_type", "handler", "status"],
      registers: [this.registry],
    });

    this.callbacksSuccess = new Counter({
      name: "graph_callbacks_success_total",
      help: "Total number of successful callback executions",
      labelNames: ["graph_type", "handler"],
      registers: [this.registry],
    });

    this.callbacksFailed = new Counter({
      name: "graph_callbacks_failed_total",
      help: "Total number of failed callback executions",
      labelNames: ["graph_type", "handler", "error_type"],
      registers: [this.registry],
    });

    this.callbacksRetried = new Counter({
      name: "graph_callbacks_retried_total",
      help: "Total number of retried callbacks",
      labelNames: ["graph_type", "handler"],
      registers: [this.registry],
    });

    this.accessDenied = new Counter({
      name: "graph_callbacks_access_denied_total",
      help: "Total number of access denied events",
      labelNames: ["reason"],
      registers: [this.registry],
    });

    this.rateLimited = new Counter({
      name: "graph_callbacks_rate_limited_total",
      help: "Total number of rate limited requests",
      labelNames: ["identifier_type"],
      registers: [this.registry],
    });

    this.tokensIssued = new Counter({
      name: "graph_callback_tokens_issued_total",
      help: "Total number of callback tokens issued",
      labelNames: ["graph_type", "handler"],
      registers: [this.registry],
    });

    this.tokensExpired = new Counter({
      name: "graph_callback_tokens_expired_total",
      help: "Total number of expired callback tokens",
      labelNames: ["graph_type"],
      registers: [this.registry],
    });

    // Initialize histograms
    this.executionDuration = new Histogram({
      name: "graph_callback_execution_duration_seconds",
      help: "Duration of callback execution in seconds",
      labelNames: ["graph_type", "handler", "status"],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
      registers: [this.registry],
    });

    this.aclValidationDuration = new Histogram({
      name: "graph_callback_acl_validation_duration_seconds",
      help: "Duration of ACL validation in seconds",
      labelNames: ["result"],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1],
      registers: [this.registry],
    });

    this.tokenAge = new Histogram({
      name: "graph_callback_token_age_seconds",
      help: "Age of callback token when executed",
      labelNames: ["graph_type"],
      buckets: [1, 5, 10, 30, 60, 120, 300, 600],
      registers: [this.registry],
    });

    // Initialize gauges
    this.activeCallbacks = new Gauge({
      name: "graph_callbacks_active",
      help: "Number of currently executing callbacks",
      labelNames: ["graph_type"],
      registers: [this.registry],
    });

    this.pendingCallbacks = new Gauge({
      name: "graph_callbacks_pending",
      help: "Number of pending callbacks in queue",
      labelNames: ["graph_type"],
      registers: [this.registry],
    });

    this.queueSize = new Gauge({
      name: "graph_callback_queue_size",
      help: "Current size of callback queue",
      registers: [this.registry],
    });
  }

  /**
   * Record callback execution start.
   */
  recordExecutionStart(graphType: string, handler?: string): void {
    const labels = { graph_type: graphType };
    this.activeCallbacks.inc(labels);
    this.pendingCallbacks.dec(labels);
  }

  /**
   * Record callback execution completion.
   */
  recordExecutionComplete(
    graphType: string,
    handler: string,
    duration: number,
    success: boolean,
    error?: string
  ): void {
    const status = success ? "success" : "failure";

    // Update counters
    this.callbacksTotal.inc({ graph_type: graphType, handler, status });

    if (success) {
      this.callbacksSuccess.inc({ graph_type: graphType, handler });
    } else {
      const errorType = this.classifyError(error);
      this.callbacksFailed.inc({
        graph_type: graphType,
        handler,
        error_type: errorType,
      });
    }

    // Record duration
    this.executionDuration.observe(
      { graph_type: graphType, handler, status },
      duration / 1000 // Convert to seconds
    );

    // Update active callbacks gauge
    this.activeCallbacks.dec({ graph_type: graphType });
  }

  /**
   * Record token issuance.
   */
  recordTokenIssued(graphType: string, handler: string): void {
    this.tokensIssued.inc({ graph_type: graphType, handler });
    this.pendingCallbacks.inc({ graph_type: graphType });
  }

  /**
   * Record token expiration.
   */
  recordTokenExpired(graphType: string): void {
    this.tokensExpired.inc({ graph_type: graphType });
    this.pendingCallbacks.dec({ graph_type: graphType });
  }

  /**
   * Record token age when executed.
   */
  recordTokenAge(graphType: string, ageMs: number): void {
    this.tokenAge.observe({ graph_type: graphType }, ageMs / 1000);
  }

  /**
   * Record ACL validation.
   */
  recordAclValidation(allowed: boolean, durationMs: number): void {
    const result = allowed ? "allowed" : "denied";
    this.aclValidationDuration.observe({ result }, durationMs / 1000);

    if (!allowed) {
      this.accessDenied.inc({ reason: "acl_validation" });
    }
  }

  /**
   * Record access denied event.
   */
  recordAccessDenied(reason: string): void {
    this.accessDenied.inc({ reason });
  }

  /**
   * Record rate limiting.
   */
  recordRateLimited(identifierType: "user" | "ip" | "token"): void {
    this.rateLimited.inc({ identifier_type: identifierType });
  }

  /**
   * Record retry attempt.
   */
  recordRetry(graphType: string, handler: string): void {
    this.callbacksRetried.inc({ graph_type: graphType, handler });
  }

  /**
   * Update queue size.
   */
  updateQueueSize(size: number): void {
    this.queueSize.set(size);
  }

  /**
   * Get metrics in Prometheus format.
   */
  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  /**
   * Get metrics content type.
   */
  getContentType(): string {
    return this.registry.contentType;
  }

  /**
   * Reset all metrics (useful for testing).
   */
  reset(): void {
    this.registry.resetMetrics();
  }

  /**
   * Classify error for metrics labeling.
   */
  private classifyError(error?: string): string {
    if (!error) return "unknown";

    const lowerError = error.toLowerCase();

    if (lowerError.includes("timeout")) return "timeout";
    if (lowerError.includes("network")) return "network";
    if (lowerError.includes("validation")) return "validation";
    if (lowerError.includes("permission") || lowerError.includes("forbidden"))
      return "permission";
    if (lowerError.includes("not found")) return "not_found";
    if (lowerError.includes("rate limit")) return "rate_limit";
    if (lowerError.includes("retry")) return "retry_exhausted";

    return "application";
  }

  /**
   * Get current metrics summary.
   */
  async getSummary(): Promise<Record<string, any>> {
    const metrics = await this.registry.getMetricsAsJSON();
    const summary: Record<string, any> = {};

    metrics.forEach((metric: any) => {
      if (metric.name === "graph_callbacks_total") {
        summary.totalCallbacks = metric.values.reduce(
          (sum: number, v: any) => sum + v.value,
          0
        );
      }
      if (metric.name === "graph_callbacks_success_total") {
        summary.successfulCallbacks = metric.values.reduce(
          (sum: number, v: any) => sum + v.value,
          0
        );
      }
      if (metric.name === "graph_callbacks_failed_total") {
        summary.failedCallbacks = metric.values.reduce(
          (sum: number, v: any) => sum + v.value,
          0
        );
      }
      if (metric.name === "graph_callbacks_active") {
        summary.activeCallbacks = metric.values.reduce(
          (sum: number, v: any) => sum + v.value,
          0
        );
      }
    });

    if (summary.totalCallbacks > 0) {
      summary.successRate =
        (summary.successfulCallbacks / summary.totalCallbacks) * 100;
    }

    return summary;
  }
}

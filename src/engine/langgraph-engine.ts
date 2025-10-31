import { Inject, Injectable, Logger } from "@nestjs/common";
import { IGraphEngine } from "../core/abstract-graph.builder";
import { EventProcessor, StreamAccumulator } from "./event-processor.utils";
import { IStoredMessageContent } from "../interfaces";
import { ConfigService } from "@nestjs/config";
/**
 * Graph engine implemented using LangGraph.js
 */

process.setMaxListeners(0);
@Injectable()
export class LangGraphEngine implements IGraphEngine {
  private readonly logger = new Logger(LangGraphEngine.name);

  constructor(
    @Inject()
    private readonly eventProcessor: EventProcessor,
    private readonly configService: ConfigService
  ) {}

  /**
   * Method to invoke LangGraph
   */
  async invokeGraph(
    graph: any,
    config: any,
    signal?: AbortSignal
  ): Promise<any> {
    // Add abort signal to configuration
    if (signal) {
      config.signal = signal;
    }

    // Invoke the graph
    const result = await graph.invoke(config.input || {}, config);

    // Transform the result
    return this.processGraphResult(result);
  }

  async streamGraph(
    graph: any,
    config: any,
    onPartial: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<any> {
    try {
      if (signal) {
        config.signal = signal;
      }

      const eventStream = await graph.streamEvents(config.input || {}, {
        ...config,
        version: "v2", // Important for correct operation
      });

      // Create accumulator to collect data from events
      const acc = this.eventProcessor.createAccumulator();

      // Process the event stream
      for await (const event of eventStream) {
        try {
          this.eventProcessor.processEvent(acc, event, onPartial);
        } catch (error) {
          this.logger.warn(
            `[STREAM-EVENT-ERROR] Error processing event: ${error.message}`
          );
        }
      }

      // Get final result from accumulator
      const { content, metrics, trace } = this.eventProcessor.getResult(acc);

      this.logger.debug("[STREAM-RESULT] Got result from EventProcessor", {
        hasContent: !!content,
        hasMetrics: !!metrics,
        modelCallsCount: metrics?.modelCalls?.length || 0,
        apiCallsCount: metrics?.apiCalls?.length || 0,
        hasContext: !!config.configurable?.context,
        hasTrace: !!trace,
        traceEvents: trace?.events?.length || 0,
      });

      // Send metrics webhook if we have metrics with data and context
      if (
        metrics &&
        metrics.modelCalls?.length > 0 &&
        config.configurable?.context
      ) {
        const context = config.configurable.context;
        await this.sendMetricsWebhook({
          messageId: context.messageId || "unknown",
          threadId: context.threadId || "unknown",
          userId: context.userId || "unknown",
          agentId: context.agentId || "unknown",
          companyId: context.companyId || "unknown",
          metrics,
        });
      } else {
        this.logger.debug("[METRICS-WEBHOOK] Skipping webhook", {
          hasMetrics: !!metrics,
          modelCallsCount: metrics?.modelCalls?.length || 0,
          hasContext: !!config.configurable?.context,
        });
      }

      if (trace && trace.events.length > 0 && config.configurable?.context) {
        const context = config.configurable.context;

        this.logger.debug("[TRACE-WEBHOOK] Sending trace events batch", {
          messageId: context.messageId,
          totalEvents: trace.totalEvents,
          eventsArrayLength: trace.events.length,
          firstEventType: trace.events[0]?.type,
        });

        // Send trace events batch to TimeSeries collection
        await this.sendTraceEventsBatch({
          messageId: context.messageId || "unknown",
          threadId: context.threadId || "unknown",
          userId: context.userId || "unknown",
          agentId: context.agentId || "unknown",
          companyId: context.companyId || "unknown",
          events: trace.events,
          totalEvents: trace.totalEvents,
          totalModelCalls: trace.totalModelCalls,
          startedAt: trace.startedAt,
          completedAt: trace.completedAt,
          durationMs: trace.durationMs,
        });
      } else {
        this.logger.debug("[TRACE-WEBHOOK] Skipping webhook", {
          hasTrace: !!trace,
          traceEvents: trace?.events?.length || 0,
          hasContext: !!config.configurable?.context,
          contextKeys: config.configurable?.context
            ? Object.keys(config.configurable.context)
            : [],
        });
      }

      return content;
    } catch (error) {
      this.logger.error(
        `[STREAM-ERROR] Error in streamGraph: ${error.message}`
      );
      this.logger.error(`[STREAM-ERROR] Stack trace: ${error.stack}`);
      throw error;
    }
  }

  /**
   * Send usage metrics to backend webhook
   */
  private async sendMetricsWebhook(payload: {
    messageId: string;
    threadId: string;
    userId: string;
    agentId: string;
    companyId: string;
    metrics: any;
  }): Promise<void> {
    try {
      const backendUrl =
        this.configService.get<string>("API_URL") || "http://amelie-service";
      const internalToken =
        this.configService.get<string>("INTERNAL_API_TOKEN");

      if (!internalToken) {
        this.logger.warn(
          "[METRICS-WEBHOOK] INTERNAL_API_TOKEN not configured, skipping webhook"
        );
        return;
      }

      const webhookUrl = `${backendUrl}/internal/usage/metrics`;

      this.logger.debug("[METRICS-WEBHOOK] Sending metrics to backend", {
        url: webhookUrl,
        messageId: payload.messageId,
        modelCallsCount: payload.metrics.modelCalls.length,
      });

      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": internalToken,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(
          `Webhook failed with status ${response.status}: ${response.statusText}`
        );
      }

      this.logger.log("✅ Metrics webhook sent successfully", {
        messageId: payload.messageId,
        modelCallsCount: payload.metrics.modelCalls.length,
      });
    } catch (error) {
      this.logger.error("[METRICS-WEBHOOK] Failed to send metrics webhook", {
        error: error.message,
        messageId: payload.messageId,
      });
      // Don't throw - metrics webhook failure shouldn't break graph execution
    }
  }

  private async sendTraceEventsBatch(payload: {
    messageId: string;
    threadId: string;
    userId: string;
    agentId: string;
    companyId: string;
    events: any[];
    totalEvents: number;
    totalModelCalls: number;
    startedAt: number;
    completedAt: number;
    durationMs: number;
  }): Promise<void> {
    try {
      const backendUrl =
        this.configService.get<string>("API_URL") || "http://amelie-service";
      const internalToken =
        this.configService.get<string>("INTERNAL_API_TOKEN");

      if (!internalToken) {
        this.logger.warn(
          "[TRACE-EVENTS-BATCH] INTERNAL_API_TOKEN not configured, skipping batch webhook"
        );
        return;
      }

      const webhookUrl = `${backendUrl}/internal/usage/trace-events/batch`;

      // Transform events to batch format
      const batchPayload = {
        messageId: payload.messageId,
        threadId: payload.threadId,
        userId: payload.userId,
        agentId: payload.agentId,
        companyId: payload.companyId,
        totalEvents: payload.totalEvents,
        totalModelCalls: payload.totalModelCalls,
        startedAt: payload.startedAt,
        completedAt: payload.completedAt,
        durationMs: payload.durationMs,
        events: payload.events.map(event => ({
          timestamp: event.timestamp
            ? new Date(event.timestamp).toISOString()
            : new Date().toISOString(),
          meta: {
            messageId: payload.messageId,
            threadId: payload.threadId,
            userId: payload.userId,
            agentId: payload.agentId,
            companyId: payload.companyId,
            type: event.type,
            nodeName: event.nodeName,
            channel: event.channel,
          },
          event: event,
        })),
      };

      this.logger.debug("[TRACE-EVENTS-BATCH] Sending batch to backend", {
        url: webhookUrl,
        messageId: payload.messageId,
        eventsCount: batchPayload.events.length,
      });

      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": internalToken,
        },
        body: JSON.stringify(batchPayload),
      });

      if (!response.ok) {
        const responseText = await response.text();
        throw new Error(
          `Batch webhook failed with status ${response.status}: ${responseText}`
        );
      }

      const responseData = await response.json();

      this.logger.log("✅ Trace events batch sent successfully", {
        messageId: payload.messageId,
        sent: batchPayload.events.length,
        stored: responseData.stored,
      });
    } catch (error) {
      this.logger.error("[TRACE-EVENTS-BATCH] Failed to send batch webhook", {
        error: error instanceof Error ? error.message : String(error),
        messageId: payload.messageId,
        eventsCount: payload.events.length,
      });
      // Don't throw - batch webhook failure shouldn't break graph execution
    }
  }

  /**
   * Process graph execution result
   */
  private processGraphResult(result: any): any {
    return {
      text: result.text,
      attachments: result.attachments,
      metadata: {
        ...result.metadata,
        usageMetrics: result?.usageRecorder,
      },
    };
  }
}

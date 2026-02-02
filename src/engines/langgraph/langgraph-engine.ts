import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { IGraphEngine } from "../../core";
import { EventProcessor } from "./event-processor.utils";
import { ConfigService } from "@nestjs/config";

/**
 * Graph engine implemented using LangGraph.js
 */

process.setMaxListeners(0);
@Injectable()
export class LangGraphEngine implements IGraphEngine {
  private readonly logger = new Logger(LangGraphEngine.name);

  constructor(
    private readonly eventProcessor: EventProcessor,
    @Optional() private readonly configService?: ConfigService
  ) {
    if (!eventProcessor) {
      this.logger.error("EventProcessor is undefined/null!");
    }
  }

  /**
   * Deserialize input recursively
   * Handles serialized LangChain objects at any level of nesting
   */
  private async deserializeInput(input: any): Promise<any> {
    const { load } = await import("@langchain/core/load");

    // Helper function to deserialize a single value
    const deserializeValue = async (value: any): Promise<any> => {
      // Case 1: Value is a serialized LangChain object (has lc property)
      if (value && typeof value === "object" && "lc" in value) {
        try {
          const deserialized = await load(JSON.stringify(value));
          this.logger.debug({
            message: "Deserialized LangChain object",
            type: deserialized.constructor?.name,
          });
          return deserialized;
        } catch (error) {
          this.logger.warn({
            message: "Failed to deserialize LangChain object",
            error: error.message,
          });
          return value;
        }
      }

      // Case 2: Value is an array - deserialize each element
      if (Array.isArray(value)) {
        return await Promise.all(value.map(item => deserializeValue(item)));
      }

      // Case 3: Value is a plain object - deserialize each property
      if (value && typeof value === "object" && value.constructor === Object) {
        const result: any = {};
        for (const [key, val] of Object.entries(value)) {
          result[key] = await deserializeValue(val);
        }
        return result;
      }

      // Case 4: Primitive value - return as is
      return value;
    };

    // Start recursive deserialization from the root
    return await deserializeValue(input);
  }

  /**
   * Method to invoke LangGraph
   */
  async invokeGraph(
    graph: any,
    preparedPayload: any,
    signal?: AbortSignal
  ): Promise<any> {
    this.logger.debug('invokeGraph preparedPayload', preparedPayload);

    // Add abort signal to configuration
    if (signal) {
      preparedPayload.signal = signal;
      this.logger.debug("[ENGINE] Signal assigned to preparedPayload.signal");
    }

    // Deserialize input if needed
    const input = await this.deserializeInput(preparedPayload.input || {});

    const result = await graph.invoke(input, {
      ...preparedPayload.config,
      signal: preparedPayload.signal,
    });

    // Transform the result
    return this.processGraphResult(result);
  }

  async streamGraph(
    graph: any,
    preparedPayload: any,
    onPartial: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<any> {
    // Create accumulator BEFORE try block to ensure it's available in finally
    const acc = this.eventProcessor.createAccumulator();
    let streamError: Error | null = null;

    this.logger.debug({
      message: "[ENGINE] streamGraph called",
      hasSignal: !!signal,
      signalType: signal?.constructor?.name,
      hasAborted: signal?.aborted,
    });

    try {
      if (signal) {
        preparedPayload.signal = signal;
        this.logger.debug("[ENGINE] Signal assigned to preparedPayload.signal");
      }

      const input = await this.deserializeInput(preparedPayload.input || {});

      const eventStream = await graph.streamEvents(input, {
        ...preparedPayload.config,
        signal: preparedPayload.signal, // Include abort signal
        version: "v2", // Important for correct operation
      });

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
    } catch (error) {
      // Capture error but don't throw yet - we need to send trace first
      streamError = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `[STREAM-ERROR] Error in streamGraph: ${streamError.message}`
      );
      this.logger.error(`[STREAM-ERROR] Stack trace: ${streamError.stack}`);
    } finally {
      // ALWAYS try to send trace events, even if graph failed
      // This ensures we capture metrics for billing even on errors
      await this.sendTraceFromAccumulator(acc, preparedPayload, streamError);
    }

    // Get final result from accumulator
    const { content, trace } = this.eventProcessor.getResult(acc);

    this.logger.debug("[STREAM-RESULT] Got result from EventProcessor", {
      hasContent: !!content,
      hasContext: !!preparedPayload.configurable?.context,
      hasTrace: !!trace,
      traceEvents: trace?.events?.length || 0,
      hadError: !!streamError,
    });

    // Re-throw the error after sending trace
    if (streamError) {
      throw streamError;
    }

    return content;
  }

  /**
   * Extract trace from accumulator and send to backend webhook
   * Called in finally block to ensure trace is sent even on errors
   */
  private async sendTraceFromAccumulator(
    acc: ReturnType<EventProcessor["createAccumulator"]>,
    config: any,
    error: Error | null
  ): Promise<void> {
    try {
      const { trace } = this.eventProcessor.getResult(acc);

      if (trace && trace.events.length > 0 && config.configurable?.context) {
        const context = config.configurable.context;

        this.logger.debug("[TRACE-WEBHOOK] Sending trace events batch", {
          messageId: context.messageId,
          totalEvents: trace.totalEvents,
          eventsArrayLength: trace.events.length,
          firstEventType: trace.events[0]?.type,
          hadError: !!error,
          errorMessage: error?.message,
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
          startedAt: trace.startedAt,
          completedAt: trace.completedAt || Date.now(),
          durationMs: trace.durationMs || Date.now() - trace.startedAt,
          status: error ? "error" : "success",
          error: error
            ? { message: error.message, name: error.name }
            : undefined,
        });
      } else {
        this.logger.debug("[TRACE-WEBHOOK] Skipping webhook", {
          hasTrace: !!trace,
          traceEvents: trace?.events?.length || 0,
          hasContext: !!config.configurable?.context,
          contextKeys: config.configurable?.context
            ? Object.keys(config.configurable.context)
            : [],
          hadError: !!error,
        });
      }
    } catch (webhookError) {
      // Don't throw - webhook failure shouldn't mask the original error
      this.logger.error(
        "[TRACE-WEBHOOK] Failed to send trace in finally block",
        {
          error:
            webhookError instanceof Error
              ? webhookError.message
              : String(webhookError),
          originalError: error?.message,
        }
      );
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
        this.configService?.get<string>("API_URL") || "http://amelie-service";
      const internalToken =
        this.configService?.get<string>("INTERNAL_API_TOKEN");

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
    startedAt: number;
    completedAt: number;
    durationMs: number;
    status?: "success" | "error";
    error?: { message: string; name: string };
  }): Promise<void> {
    try {
      const backendUrl =
        this.configService?.get<string>("API_URL") || "http://amelie-service";
      const internalToken =
        this.configService?.get<string>("INTERNAL_API_TOKEN");

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
        startedAt: payload.startedAt,
        completedAt: payload.completedAt,
        durationMs: payload.durationMs,
        status: payload.status || "success",
        error: payload.error,
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

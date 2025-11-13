/**
 * Universal LangGraph stream processing and result extraction utilities
 */

import {
  IContentBlock,
  IContentChain,
  StreamChannel,
  IStoredMessageContent,
  IAttachment,
} from "../../messages";
import { IGraphTraceEvent } from "../../graph/tracing";
import { Injectable, Logger } from "@nestjs/common";
import { sanitizeTraceData } from "../api-call-tracer.utils";

/**
 * LLM call record collected from on_chat_model_end events
 */
export interface LLMCallRecord {
  modelId: string; // Internal MongoDB model ID
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  timestamp: number;
  nodeName?: string; // LangGraph node name
}

/**
 * Stream accumulator for collecting events during graph execution
 * Each stream creates its own accumulator to ensure thread-safety
 */
export interface StreamAccumulator {
  contentChains: IContentChain[]; // All completed chains from both TEXT and PROCESSING channels
  currentSteps: Map<StreamChannel, IContentBlock[]>; // Accumulating steps per channel
  currentToolIndex: Map<StreamChannel, number | null>; // Track current tool by index (for input_json_delta)
  finalAttachments: IAttachment[]; // Attachments from on_chain_end
  finalMetadata: Record<string, any>; // Metadata from on_chain_end
  llmCalls: LLMCallRecord[]; // Collected LLM metrics from on_chat_model_end events
  traceEvents: IGraphTraceEvent[];
  traceStartedAt: number | null;
  traceCompletedAt: number | null;
}

/**
 * Stateless event processor for LangGraph streams
 * Thread-safe: state is passed via accumulator parameter, not stored in class
 */
@Injectable()
export class EventProcessor {
  private readonly logger = new Logger(EventProcessor.name);

  /**
   * Create new accumulator for a stream
   */
  createAccumulator(): StreamAccumulator {
    return {
      contentChains: [],
      currentSteps: new Map([
        [StreamChannel.TEXT, []],
        [StreamChannel.PROCESSING, []],
      ]),
      currentToolIndex: new Map([
        [StreamChannel.TEXT, null],
        [StreamChannel.PROCESSING, null],
      ]),
      finalAttachments: [],
      finalMetadata: {},
      llmCalls: [],
      traceEvents: [],
      traceStartedAt: null,
      traceCompletedAt: null,
    };
  }

  /**
   * Normalize content to unified array of blocks
   * Handles string, array, or single object formats
   *
   * Output format examples:
   * - Text: [{ type: "text", text: "Hello" }]
   * - Tool call: [{ type: "tool_use", id: "toolu_123", name: "get_weather", input: {...} }]
   * - Tool input delta: [{ type: "input_json_delta", input: "{\"city\": \"" }]
   * - Mixed: [{ type: "tool_use", ... }, { type: "text", text: "..." }]
   */
  private normalizeContentBlocks(content: any): any[] {
    if (!content) {
      return [];
    }

    // Already an array of blocks
    if (Array.isArray(content)) {
      return content;
    }

    // String content -> wrap in text block
    if (typeof content === "string") {
      return content.trim() ? [{ type: "text", text: content }] : [];
    }

    // Single object block
    if (typeof content === "object") {
      return [content];
    }

    return [];
  }


  /**
   * Process a LangGraph stream event
   * Mutates accumulator to collect data from different channels
   * @param onPartial Optional callback for streaming chunks to UI (omit for invoke without streaming)
   */
  processEvent(
    acc: StreamAccumulator,
    event: any,
    onPartial?: (chunk: string) => void
  ): void {
    this.captureTraceEvent(acc, event);

    // Determine channel (default to TEXT if undefined)
    const channel = (event.metadata?.stream_channel as StreamChannel) ?? StreamChannel.TEXT;

    // 1. Streaming: accumulate content blocks (universal for both channels)
    if (event.event === "on_chat_model_stream" && event.data?.chunk?.content) {
      const chunk = event.data.chunk.content;
      const blocks = this.normalizeContentBlocks(chunk);
      const steps = acc.currentSteps.get(channel)!;

      for (const block of blocks) {
        if (block.type === "tool_use" || block.type === "tool_call") {
          // Create new tool and add to steps immediately
          const newTool: IContentBlock = {
            index: block.index ?? steps.length,
            type: "tool_use",
            name: block.name,
            id: block.id,
            input: block.input || "",
            output: "", // Will accumulate via index lookup
          };
          steps.push(newTool);

          // Remember index for subsequent deltas
          acc.currentToolIndex.set(channel, newTool.index);

          // Send to UI (different format per channel)
          if (onPartial) {
            if (channel === StreamChannel.PROCESSING) {
              onPartial(
                JSON.stringify({
                  processing_delta: { type: "step_started", step: newTool },
                })
              );
            } else {
              onPartial(JSON.stringify({ text: [block] }));
            }
          }
        } else if (block.type === "input_json_delta") {
          // Find current tool by index and accumulate output
          const toolIndex = acc.currentToolIndex.get(channel);
          if (toolIndex !== null) {
            const tool = steps.find((s) => s.index === toolIndex);
            if (tool) {
              const deltaChunk = block.input || "";
              tool.output += deltaChunk;

              if (onPartial) {
                if (channel === StreamChannel.PROCESSING) {
                  onPartial(
                    JSON.stringify({
                      processing_delta: {
                        type: "output_chunk",
                        stepId: tool.id,
                        chunk: deltaChunk,
                      },
                    })
                  );
                } else {
                  onPartial(JSON.stringify({ text: [block] }));
                }
              }
            }
          }
        } else if (block.type === "text") {
          // Text block means tool is complete (if any)
          acc.currentToolIndex.set(channel, null);

          // Add text block
          steps.push({
            index: steps.length,
            type: "text",
            text: block.text || "",
          });

          // Send to UI (TEXT channel only)
          if (onPartial && channel === StreamChannel.TEXT) {
            onPartial(JSON.stringify({ text: [block] }));
          }
        }
      }

      return;
    }

    // 3. Tool events: log tool execution lifecycle
    if (event.event === "on_tool_start") {
      this.logger.log("🔧 Tool execution started", {
        toolName: event.name,
        input: event.data?.input,
        runId: event.run_id,
        metadata: event.metadata,
      });
      return;
    }

    if (event.event === "on_tool_end") {
      this.logger.log("✅ Tool execution completed", {
        toolName: event.name,
        output:
          typeof event.data?.output === "string"
            ? event.data.output.substring(0, 200) +
              (event.data.output.length > 200 ? "..." : "")
            : event.data?.output,
        runId: event.run_id,
      });
      return;
    }

    if (event.event === "on_tool_error") {
      this.logger.error("❌ Tool execution failed", {
        toolName: event.name,
        error: event.data?.error,
        runId: event.run_id,
      });
      return;
    }

    // 3. Model end: finalize content chain (universal for both channels)
    if (event.event === "on_chat_model_end") {
      const output = event.data?.output;
      const steps = acc.currentSteps.get(channel)!;

      // Clear tool index (tool already in steps)
      acc.currentToolIndex.set(channel, null);

      // Save completed chain if has content
      if (steps.length > 0) {
        acc.contentChains.push({
          channel,
          steps: [...steps],
          isComplete: true,
        });

        // Send completion event for PROCESSING channel
        if (channel === StreamChannel.PROCESSING && onPartial) {
          onPartial(
            JSON.stringify({
              processing_delta: { type: "chain_completed" },
            })
          );
        }

        // Reset for next chain
        acc.currentSteps.set(channel, []);
      }

      // Collect LLM metrics
      const usageMetadata = output?.usage_metadata || output?.usageMetadata;
      const modelId = event.metadata?.modelId;

      if (usageMetadata && modelId) {
        const llmCall: LLMCallRecord = {
          modelId,
          promptTokens: usageMetadata.input_tokens || 0,
          completionTokens: usageMetadata.output_tokens || 0,
          totalTokens: usageMetadata.total_tokens || 0,
          timestamp: Date.now(),
          nodeName: event.metadata?.langgraph_node || event.name,
        };

        acc.llmCalls.push(llmCall);

        this.logger.log("✅ LLM call recorded", {
          modelId,
          tokens: llmCall.totalTokens,
          nodeName: llmCall.nodeName,
          totalRecorded: acc.llmCalls.length,
        });
      }

      return;
    }

    // 4. Chain end: extract attachments and metadata (TEXT channel only)
    if (event.event === "on_chain_end") {
      const isTextChannel =
        channel === StreamChannel.TEXT || !event.metadata?.stream_channel;

      if (isTextChannel) {
        const output = event.data.output;

        // Extract from different graph output formats
        if (output?.answer) {
          acc.finalAttachments = output.answer.attachments || [];
          acc.finalMetadata = output.answer.metadata || {};
        } else if (output?.generation) {
          acc.finalAttachments = output.generation.attachments || [];
          acc.finalMetadata = output.generation.metadata || {};
        } else if (output?.text) {
          acc.finalAttachments = output.attachments || [];
          acc.finalMetadata = output.metadata || {};
        }
      }

      return;
    }
  }

  /**
   * Build final result from accumulator
   * Returns unified content chains with attachments and metadata
   */
  getResult(acc: StreamAccumulator): {
    content: IStoredMessageContent;
    trace: {
      events: IGraphTraceEvent[];
      startedAt: number;
      completedAt: number;
      durationMs: number;
      totalEvents: number;
      totalModelCalls: number;
    } | null;
    metrics: {
      modelCalls: LLMCallRecord[];
    } | null;
  } {
    const startedAt = acc.traceStartedAt ?? Date.now();
    const completedAt = acc.traceCompletedAt ?? startedAt;

    const trace =
      acc.traceEvents.length > 0
        ? {
            events: acc.traceEvents,
            startedAt,
            completedAt,
            durationMs: Math.max(0, completedAt - startedAt),
            totalEvents: acc.traceEvents.length,
            totalModelCalls: acc.llmCalls.length,
          }
        : null;

    const metrics =
      acc.llmCalls.length > 0
        ? {
            modelCalls: acc.llmCalls,
          }
        : null;

    if (trace) {
      this.logger.log("📊 [EventProcessor] Final trace assembled", {
        totalEvents: trace.totalEvents,
        contentChainsCount: acc.contentChains.length,
        textChains: acc.contentChains.filter((c) => c.channel === "text")
          .length,
        processingChains: acc.contentChains.filter(
          (c) => c.channel === "processing"
        ).length,
      });
    }

    return {
      content: {
        contentChains:
          acc.contentChains.length > 0 ? acc.contentChains : undefined,
        attachments: acc.finalAttachments,
        metadata: acc.finalMetadata,
      },
      trace,
      metrics,
    };
  }

  private captureTraceEvent(acc: StreamAccumulator, event: any): void {
    // Normalize the event before storing
    const normalized = this.normalizeTraceEvent(event);

    if (!normalized) {
      return; // Skip events that can't be normalized (stream chunks, etc.)
    }

    acc.traceEvents.push(normalized);
    this.logger.debug(
      `[TRACE] Captured trace event ${normalized.type} for node ${normalized.nodeName} (${acc.traceEvents.length} total)`
    );
  }

  private normalizeTraceEvent(event: any): IGraphTraceEvent | null {
    const type = event?.event ?? event?.type;
    if (!type) {
      return null;
    }

    const normalizedType = String(type);

    // Debug: Log raw event structure for chain events
    if (normalizedType.includes("chain") && !event?.name) {
      this.logger.debug(`[TRACE] Chain event WITHOUT name field:`, {
        type: normalizedType,
        eventKeys: Object.keys(event || {}).join(", "),
        hasMetadata: !!event?.metadata,
        metadataKeys: event?.metadata
          ? Object.keys(event.metadata).join(", ")
          : "none",
      });
    }

    // Skip streaming chunk events
    if (normalizedType.toLowerCase() === "stream_chunk") {
      return null;
    }

    const chunkType = event?.data?.chunk?.type || event?.data?.chunk?.event;
    if (
      typeof chunkType === "string" &&
      chunkType.toLowerCase() === "stream_chunk"
    ) {
      return null;
    }

    // Skip on_chat_model_stream events - they generate too many trace entries
    // We only need on_chat_model_end for token tracking
    if (normalizedType === "on_chat_model_stream") {
      return null;
    }

    const name = event?.name ? String(event.name) : undefined;

    // Skip internal LangGraph infrastructure events first
    if (
      name &&
      (name.includes("ChannelWrite") ||
        name.includes("ChannelRead") ||
        name.includes("ChannelInvoke") ||
        name.includes("Branch<"))
    ) {
      this.logger.debug(
        `[TRACE] Skipping infrastructure event: ${name} (type: ${normalizedType})`
      );
      return null;
    }

    // Log events that pass the filter to see what's being stored
    if (normalizedType.includes("chain") && name) {
      this.logger.debug(
        `[TRACE] Accepting event: name="${name}", type="${normalizedType}", hasNode=${!!event?.metadata?.langgraph_node}`
      );
    }

    // Skip wrapper LangGraph events (they have no langgraph_node in metadata)
    // These are top-level graph events that duplicate info from inner nodes
    const hasLangGraphNode = event?.metadata?.langgraph_node;
    if (!hasLangGraphNode && type.startsWith("on_chain")) {
      return null; // Skip top-level graph wrapper events
    }

    // Use unified sanitization from api-call-tracer
    // NOTE: We sanitize metadata and data, but NOT the events array itself
    // to avoid truncating the array to MAX_COLLECTION_LENGTH (20 items)
    const metadata = sanitizeTraceData(event?.metadata) as
      | Record<string, unknown>
      | undefined;
    const data = sanitizeTraceData(event?.data) as
      | Record<string, unknown>
      | undefined;

    const timestampSource =
      event?.timestamp ??
      event?.time ??
      event?.data?.timestamp ??
      event?.data?.ts ??
      Date.now();

    const timestamp = Number(timestampSource) || Date.now();

    const streamChannel =
      typeof event?.metadata?.stream_channel === "string"
        ? event.metadata.stream_channel
        : typeof (metadata as any)?.stream_channel === "string"
          ? ((metadata as any).stream_channel as string)
          : undefined;

    const nodeNameFromMetadata = (metadata as any)?.langgraph_node;
    const fallbackNodeName = (metadata as any)?.node_name;

    return {
      type: normalizedType,
      name,
      channel: streamChannel,
      nodeName:
        (typeof nodeNameFromMetadata === "string"
          ? nodeNameFromMetadata
          : typeof fallbackNodeName === "string"
            ? fallbackNodeName
            : name) || undefined,
      timestamp,
      metadata,
      data,
    };
  }
}

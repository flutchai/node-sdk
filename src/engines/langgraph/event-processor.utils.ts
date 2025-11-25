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
 * State for a single channel
 */
export interface ChannelState {
  contentChain: IContentBlock[]; // Accumulated blocks for the chain
  currentBlock: IContentBlock | null; // Block currently being streamed
}

/**
 * Stream accumulator for collecting events during graph execution
 * Each stream creates its own accumulator to ensure thread-safety
 */
export interface StreamAccumulator {
  // Per-channel state (unified structure)
  channels: Map<StreamChannel, ChannelState>;

  // Common data
  attachments: IAttachment[];
  metadata: Record<string, any>;
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
      channels: new Map([
        [StreamChannel.TEXT, { contentChain: [], currentBlock: null }],
        [StreamChannel.PROCESSING, { contentChain: [], currentBlock: null }],
      ]),
      attachments: [],
      metadata: {},
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
   * Send delta to UI (unified format)
   */
  private sendDelta(
    channel: StreamChannel,
    delta: any,
    onPartial?: (chunk: string) => void
  ): void {
    if (!onPartial) return;

    onPartial(
      JSON.stringify({
        channel,
        delta,
      })
    );
  }

  /**
   * Process content stream blocks (universal for all channels)
   */
  private processContentStream(
    acc: StreamAccumulator,
    channel: StreamChannel,
    blocks: any[],
    onPartial?: (chunk: string) => void
  ): void {
    const state = acc.channels.get(channel)!;

    for (const block of blocks) {
      if (block.type === "tool_use" || block.type === "tool_call") {
        // Finalize current block if exists
        if (state.currentBlock) {
          state.contentChain.push(state.currentBlock);
        }

        // Create new tool block
        state.currentBlock = {
          index: state.contentChain.length,
          type: "tool_use",
          name: block.name,
          id: block.id,
          input: block.input || "",
          output: "",
        };

        // Send delta
        this.sendDelta(
          channel,
          {
            type: "step_started",
            step: state.currentBlock,
          },
          onPartial
        );
      } else if (block.type === "input_json_delta") {
        // Accumulate tool INPUT (parameters)
        if (state.currentBlock && state.currentBlock.type === "tool_use") {
          const chunk = block.input || "";
          state.currentBlock.input += chunk;

          // Send delta
          this.sendDelta(
            channel,
            {
              type: "tool_input_chunk",
              stepId: state.currentBlock.id,
              chunk: chunk,
            },
            onPartial
          );
        }
      } else if (block.type === "text") {
        const textChunk = block.text || "";

        // If current block is text, accumulate
        if (state.currentBlock && state.currentBlock.type === "text") {
          state.currentBlock.text = (state.currentBlock.text || "") + textChunk;
        } else {
          // Finalize previous block (tool)
          if (state.currentBlock) {
            state.contentChain.push(state.currentBlock);
          }

          // Create new text block
          state.currentBlock = {
            index: state.contentChain.length,
            type: "text",
            text: textChunk,
          };
        }

        // Send delta
        this.sendDelta(
          channel,
          {
            type: "text_chunk",
            text: textChunk,
          },
          onPartial
        );
      }
    }
  }

  /**
   * Groups tool_use and input_json_delta into proper structure
   * tool_use.input → output (tool execution result)
   * input_json_delta.input → output (tool execution result, accumulated)
   * @deprecated This method is for legacy fallback only
   */
  private mapReasoningSteps(rawSteps: any[]): IContentBlock[] {
    const steps: IContentBlock[] = [];
    let currentToolUse: IContentBlock | null = null;

    for (const raw of rawSteps) {
      if (raw.type === "tool_use" || raw.type === "tool_call") {
        // Save previous tool_use if exists
        if (currentToolUse) {
          steps.push(currentToolUse);
        }

        // Create new tool_use
        // tool_use.input contains tool execution result (OUT)
        currentToolUse = {
          index: raw.index || 0,
          type: "tool_use",
          name: raw.name,
          id: raw.id,
          input: "", // Parameters (IN) - filled separately or empty
          output: raw.input || "", // Result (OUT) - comes in tool_use.input
        };
      } else if (raw.type === "input_json_delta") {
        // input_json_delta.input contains execution result (streaming) → output
        if (currentToolUse) {
          currentToolUse.output =
            (currentToolUse.output || "") + (raw.input || "");
        }
      } else {
        // Regular step (text, thinking, tool_result)
        if (currentToolUse) {
          steps.push(currentToolUse);
          currentToolUse = null;
        }

        steps.push({
          index: raw.index || 0,
          type: raw.type,
          text: raw.text || "",
          metadata: raw.metadata,
        });
      }
    }

    // Don't forget the last tool_use
    if (currentToolUse) {
      steps.push(currentToolUse);
    }

    return steps;
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

    // 1. Streaming content (universal for all channels)
    if (event.event === "on_chat_model_stream" && event.data?.chunk?.content) {
      const channel =
        (event.metadata?.stream_channel as StreamChannel) ?? StreamChannel.TEXT;
      const blocks = this.normalizeContentBlocks(event.data.chunk.content);

      this.processContentStream(acc, channel, blocks, onPartial);
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
      const channel =
        (event.metadata?.stream_channel as StreamChannel) ?? StreamChannel.TEXT;
      const state = acc.channels.get(channel);

      if (state?.currentBlock && state.currentBlock.type === "tool_use") {
        // Set tool OUTPUT (result of execution)
        const output = event.data?.output;
        const outputString =
          typeof output === "string" ? output : JSON.stringify(output, null, 2);

        state.currentBlock.output = outputString;

        // Send delta with tool output
        this.sendDelta(
          channel,
          {
            type: "tool_output_chunk",
            stepId: state.currentBlock.id,
            chunk: outputString,
          },
          onPartial
        );

        this.logger.log("✅ Tool execution completed", {
          toolName: event.name,
          outputPreview:
            outputString.substring(0, 200) +
            (outputString.length > 200 ? "..." : ""),
          runId: event.run_id,
        });
      }
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

    // 2. Model end: just log, no finalization needed
    if (event.event === "on_chat_model_end") {
      this.logger.debug("✅ LLM call completed", {
        nodeName: event.metadata?.langgraph_node || event.name,
        channel: event.metadata?.stream_channel,
      });
      return;
    }

    // 3. Chain end: extract final attachments and metadata (TEXT channel only)
    if (event.event === "on_chain_end") {
      const channel =
        (event.metadata?.stream_channel as StreamChannel) ?? StreamChannel.TEXT;

      if (channel === StreamChannel.TEXT) {
        const output = event.data.output;

        // Extract attachments and metadata from different graph output formats
        if (output?.answer) {
          acc.attachments = output.answer.attachments || [];
          acc.metadata = output.answer.metadata || {};
        } else if (output?.generation) {
          acc.attachments = output.generation.attachments || [];
          acc.metadata = output.generation.metadata || {};
        } else if (output) {
          acc.attachments = output.attachments || [];
          acc.metadata = output.metadata || {};
        }
      }

      return;
    }
  }

  /**
   * Build final result from accumulator
   * Returns unified content chains from all channels
   */
  getResult(acc: StreamAccumulator): {
    content: IStoredMessageContent;
    trace: {
      events: IGraphTraceEvent[];
      startedAt: number;
      completedAt: number;
      durationMs: number;
      totalEvents: number;
    } | null;
  } {
    // Build chains from accumulated blocks
    const allChains: IContentChain[] = [];

    for (const [channel, state] of acc.channels.entries()) {
      // Finalize current block if exists
      if (state.currentBlock) {
        state.contentChain.push(state.currentBlock);
      }

      // Create chain if has blocks
      if (state.contentChain.length > 0) {
        allChains.push({
          channel,
          steps: state.contentChain,
          isComplete: true,
        });
      }
    }

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
          }
        : null;

    // Extract text from text channel for backwards compatibility
    const textChain = allChains.find(c => c.channel === "text");
    const text = textChain
      ? textChain.steps
          .filter(step => step.type === "text")
          .map(step => step.text || "")
          .join("")
      : "";

    this.logger.log("📊 [EventProcessor] Final result assembled", {
      totalChains: allChains.length,
      textChains: allChains.filter(c => c.channel === "text").length,
      processingChains: allChains.filter(c => c.channel === "processing")
        .length,
      totalSteps: allChains.reduce((sum, c) => sum + c.steps.length, 0),
      textLength: text.length,
    });

    return {
      content: {
        contentChains: allChains.length > 0 ? allChains : undefined,
        attachments: acc.attachments,
        metadata: acc.metadata,
        text, // Add extracted text for backwards compatibility
      },
      trace,
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

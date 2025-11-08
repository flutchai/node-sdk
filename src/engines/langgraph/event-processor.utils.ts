/**
 * Universal LangGraph stream processing and result extraction utilities
 */

import {
  IReasoningStep,
  IReasoningChain,
  StreamChannel,
  IStoredMessageContent,
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
  streamedText: string; // Accumulated text from TEXT channel (for fallback)
  reasoningChains: IReasoningChain[]; // All reasoning chains from PROCESSING channel
  generation: IStoredMessageContent | null; // Final generation from on_chain_end
  llmCalls: LLMCallRecord[]; // Collected LLM metrics from on_chat_model_end events
  traceEvents: IGraphTraceEvent[];
  traceStartedAt: number | null;
  traceCompletedAt: number | null;
  // Real-time reasoning step accumulator for streaming
  currentReasoningSteps: IReasoningStep[]; // Current reasoning steps being accumulated
  currentToolUse: IReasoningStep | null; // Current tool_use being built from input_json_delta events
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
      streamedText: "",
      reasoningChains: [],
      generation: null,
      llmCalls: [],
      traceEvents: [],
      traceStartedAt: null,
      traceCompletedAt: null,
      currentReasoningSteps: [],
      currentToolUse: null,
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
   * Groups tool_use and input_json_delta into proper structure
   * tool_use.input → output (tool execution result)
   * input_json_delta.input → output (tool execution result, accumulated)
   */
  private mapReasoningSteps(rawSteps: any[]): IReasoningStep[] {
    const steps: IReasoningStep[] = [];
    let currentToolUse: IReasoningStep | null = null;

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

    // 1. Streaming TEXT channel: normalize and send all content blocks to UI
    if (
      event.event === "on_chat_model_stream" &&
      event.metadata?.stream_channel === StreamChannel.TEXT &&
      event.data?.chunk?.content
    ) {
      const chunk = event.data.chunk.content;

      // Normalize content to array of blocks for unified frontend handling
      const blocks = this.normalizeContentBlocks(chunk);

      // Send all blocks to UI (tool_use, input_json_delta, text)
      if (blocks.length > 0 && onPartial) {
        onPartial(JSON.stringify({ text: blocks }));
      }

      // Accumulate only text blocks for fallback
      const textOnly = blocks
        .filter((block: any) => block?.type === "text")
        .map((block: any) => block.text || "")
        .join("");

      if (textOnly) {
        acc.streamedText += textOnly;
      }

      return;
    }

    // 2. Streaming PROCESSING channel: send delta events
    if (
      event.event === "on_chat_model_stream" &&
      event.metadata?.stream_channel === StreamChannel.PROCESSING &&
      event.data?.chunk?.content
    ) {
      const chunk = event.data.chunk.content;

      // Normalize content to array of blocks
      const blocks = this.normalizeContentBlocks(chunk);

      // Process each block and send delta updates
      for (const block of blocks) {
        if (block.type === "tool_use" || block.type === "tool_call") {
          // Save previous tool_use if exists
          if (acc.currentToolUse) {
            acc.currentReasoningSteps.push(acc.currentToolUse);
          }

          // Create new tool_use
          acc.currentToolUse = {
            index: acc.currentReasoningSteps.length,
            type: "tool_use",
            name: block.name,
            id: block.id,
            input: block.input || "",
            output: "",
          };

          // Send step_started event
          if (onPartial) {
            onPartial(
              JSON.stringify({
                processing_delta: {
                  type: "step_started",
                  step: acc.currentToolUse,
                },
              })
            );
          }
        } else if (block.type === "input_json_delta") {
          // Accumulate output and send chunk
          if (acc.currentToolUse && onPartial) {
            const chunk = block.input || "";
            acc.currentToolUse.output += chunk;

            // Send output_chunk event
            onPartial(
              JSON.stringify({
                processing_delta: {
                  type: "output_chunk",
                  stepId: acc.currentToolUse.id,
                  chunk: chunk,
                },
              })
            );
          }
        }
      }

      return;
    }

    // 3. Finalize LLM call: collect metrics from all on_chat_model_end events
    if (event.event === "on_chat_model_end") {
      // Extract usage metrics from the event
      const output = event.data?.output;
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
      } else {
        this.logger.warn(
          "⚠️ Missing usage metadata or modelId in on_chat_model_end",
          {
            hasUsageMetadata: !!usageMetadata,
            hasModelId: !!modelId,
            eventName: event.name,
            metadataKeys: event.metadata ? Object.keys(event.metadata) : [],
            outputKeys: output ? Object.keys(output) : [],
          }
        );
      }

      // Finalize reasoning chain from PROCESSING channel
      if (event.metadata?.stream_channel === StreamChannel.PROCESSING) {
        // Finalize any pending tool_use
        if (acc.currentToolUse) {
          acc.currentReasoningSteps.push(acc.currentToolUse);
          acc.currentToolUse = null;
        }

        // Save completed chain
        if (acc.currentReasoningSteps.length > 0) {
          acc.reasoningChains.push({
            steps: acc.currentReasoningSteps,
            isComplete: true,
          });

          // Send chain_completed event
          if (onPartial) {
            onPartial(
              JSON.stringify({
                processing_delta: {
                  type: "chain_completed",
                },
              })
            );
          }

          // Reset for next chain
          acc.currentReasoningSteps = [];
        } else {
          // Fallback: parse from output if streaming didn't accumulate steps
          const stepsRaw =
            output?.content || // AIMessageChunk object (direct)
            output?.kwargs?.content || // Serialized LangChain format
            event.data?.chunk?.content || // Older version
            [];

          let steps: IReasoningStep[];

          // Normalize to array of IReasoningStep
          if (Array.isArray(stepsRaw)) {
            // Map tool_use and input_json_delta to proper structure
            steps = this.mapReasoningSteps(stepsRaw);
          } else if (
            typeof stepsRaw === "string" &&
            stepsRaw.trim().length > 0
          ) {
            // Convert string to single text step
            // This happens when LLM returns reasoning as plain text instead of structured steps
            steps = [
              {
                index: 0,
                type: "text",
                text: stepsRaw.trim(),
              },
            ];
          } else {
            // Empty or invalid - skip
            steps = [];
          }

          if (steps.length > 0) {
            acc.reasoningChains.push({
              steps,
              isComplete: true,
            });

            // Send chain_completed event
            if (onPartial) {
              onPartial(
                JSON.stringify({
                  processing_delta: {
                    type: "chain_completed",
                  },
                })
              );
            }
          }
        }
      }
      return;
    }

    // 4. Finalize TEXT: save generation object (final result)
    if (
      event.event === "on_chain_end" &&
      event.metadata?.stream_channel === StreamChannel.TEXT
    ) {
      const output = event.data.output;

      // Normalize different graph output formats to standard IStoredMessageContent:
      // - React graph: { answer: { text } }
      // - RAG graph: { generation: { text, attachments } }
      // - Simple graph: { generation: AIMessage }
      // - Direct: { text, attachments, metadata }
      let generation: IStoredMessageContent | null = null;

      if (output?.answer?.text) {
        // React graph format
        generation = {
          text: output.answer.text,
          attachments: output.answer.attachments || [],
          metadata: output.answer.metadata || {},
        };
      } else if (output?.generation?.text) {
        // RAG graph format
        generation = {
          text: output.generation.text,
          attachments: output.generation.attachments || [],
          metadata: output.generation.metadata || {},
        };
      } else if (output?.generation?.content) {
        // Simple graph format (AIMessage object)
        generation = {
          text: output.generation.content,
          attachments: [],
          metadata: {},
        };
      } else if (output?.text) {
        // Direct format
        generation = {
          text: output.text,
          attachments: output.attachments || [],
          metadata: output.metadata || {},
        };
      }

      // DON'T send full text via onPartial here - it was already streamed via on_chat_model_stream
      // This generation object is only used as fallback if streaming didn't work
      // Sending it here causes duplicate full-text events on the frontend

      acc.generation = generation;
      return;
    }
  }

  /**
   * Build final result from accumulator
   * Uses generation if available, otherwise falls back to streamed text
   * Returns content and metrics separately (metrics should NOT be stored in message.metadata)
   */
  getResult(acc: StreamAccumulator): {
    content: IStoredMessageContent;
    metrics: {
      modelCalls: Array<{
        nodeName: string;
        timestamp: number;
        modelId: string;
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        latencyMs: number;
      }>;
      apiCalls: any[];
    } | null;
    trace: {
      events: IGraphTraceEvent[];
      startedAt: number;
      completedAt: number;
      durationMs: number;
      totalEvents: number;
      totalModelCalls: number;
    } | null;
  } {
    // Calculate total metrics from all LLM calls
    const totalPromptTokens = acc.llmCalls.reduce(
      (sum, call) => sum + call.promptTokens,
      0
    );
    const totalCompletionTokens = acc.llmCalls.reduce(
      (sum, call) => sum + call.completionTokens,
      0
    );
    const totalTokens = acc.llmCalls.reduce(
      (sum, call) => sum + call.totalTokens,
      0
    );

    this.logger.log("📊 Final metrics collected", {
      llmCallsCount: acc.llmCalls.length,
      totalPromptTokens,
      totalCompletionTokens,
      totalTokens,
      modelIds: acc.llmCalls.map(c => c.modelId),
    });

    const metrics =
      acc.llmCalls.length > 0
        ? {
            modelCalls: acc.llmCalls.map(call => ({
              nodeName: call.nodeName || "unknown",
              timestamp: call.timestamp,
              modelId: call.modelId,
              promptTokens: call.promptTokens,
              completionTokens: call.completionTokens,
              totalTokens: call.totalTokens,
              latencyMs: 0, // Not calculated from events
            })),
            apiCalls: [], // TODO: Add API calls tracking (rerank, embeddings) via custom events
          }
        : null;

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

    if (trace) {
      this.logger.log("📊 [EventProcessor] Final trace assembled", {
        totalEvents: trace.totalEvents,
        eventsArrayLength: trace.events.length,
        firstEventType: trace.events[0]?.type,
        lastEventType: trace.events[trace.events.length - 1]?.type,
        firstEventSample: trace.events[0]
          ? JSON.stringify(trace.events[0]).substring(0, 150)
          : null,
        allEventsNull: trace.events.every(e => e === null),
        someEventsNull: trace.events.some(e => e === null),
      });
    }

    return {
      content: {
        text: acc.generation?.text || acc.streamedText || "",
        attachments: acc.generation?.attachments || [],
        metadata: acc.generation?.metadata || {},
        reasoningChains:
          acc.reasoningChains.length > 0 ? acc.reasoningChains : undefined,
      },
      metrics,
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

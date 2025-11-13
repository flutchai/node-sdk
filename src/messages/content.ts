/**
 * Message content types
 */

import { IAttachment } from "./attachments";
import { IContentChain } from "./reasoning";
import { ITracingEvent, IToolCall } from "./tracing";

/** Stored message content */
export interface IStoredMessageContent {
  contentChains?: IContentChain[]; // Unified structured content from all channels (TEXT, PROCESSING)
  attachments?: IAttachment[];
  metadata?: Record<string, any>;
  tracingEvents?: ITracingEvent[];
  currentToolCall?: IToolCall | null; // Current tool call (TEXT channel, streaming only - transient)
  // Legacy fields (deprecated, will be removed)
  text?: string;
  reasoningChains?: IContentChain[];
  hasReasoningProcess?: boolean;
}

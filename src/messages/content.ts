/**
 * Message content types
 */

import { IAttachment } from "./attachments";
import { IContentChain, IReasoningChain } from "./reasoning";
import { ITracingEvent, IToolCall } from "./tracing";

/** Stored message content */
export interface IStoredMessageContent {
  // New unified structure
  contentChains?: IContentChain[];

  // Common fields
  attachments?: IAttachment[];
  metadata?: Record<string, any>;

  // Legacy fields (for backward compatibility)
  text?: string;
  reasoningChains?: IReasoningChain[];
  tracingEvents?: ITracingEvent[];
  hasReasoningProcess?: boolean;
  currentToolCall?: IToolCall | null;
}

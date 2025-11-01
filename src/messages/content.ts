/**
 * Message content types
 */

import { IAttachment } from "./attachments";
import { IReasoningChain } from "./reasoning";
import { ITracingEvent, IToolCall } from "./tracing";

/** Stored message content */
export interface IStoredMessageContent {
  text?: string;
  attachments?: IAttachment[];
  metadata?: Record<string, any>;
  tracingEvents?: ITracingEvent[];
  reasoningChains?: IReasoningChain[];
  hasReasoningProcess?: boolean;
  currentToolCall?: IToolCall | null;
}

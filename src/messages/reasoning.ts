/**
 * Universal content block types (used for both TEXT and PROCESSING channels)
 */

/** Universal content block (replaces IReasoningStep) */
export interface IContentBlock {
  index: number; // Used to match tool_use with input_json_delta chunks
  type: "text" | "tool_use";
  text?: string;
  metadata?: Record<string, any>;
  // Fields for tool_use type
  name?: string;
  id?: string;
  input?: string; // Tool parameters (IN)
  output?: string; // Tool result (OUT)
}

/** Universal content chain (replaces IReasoningChain) */
export interface IContentChain {
  channel: string; // "text" | "processing"
  steps: IContentBlock[];
  isComplete: boolean;
}

/** @deprecated Use IContentBlock instead */
export type IReasoningStep = IContentBlock;

/** @deprecated Use IContentChain instead */
export type IReasoningChain = IContentChain;

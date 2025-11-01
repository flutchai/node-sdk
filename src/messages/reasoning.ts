/**
 * Reasoning chain types
 */

/** Reasoning step in a chain */
export interface IReasoningStep {
  index: number;
  type: "text" | "tool_call" | "tool_result" | "thinking" | "tool_use";
  text?: string;
  metadata?: Record<string, any>;
}

/** Chain of reasoning steps */
export interface IReasoningChain {
  steps: IReasoningStep[];
  isComplete: boolean;
}

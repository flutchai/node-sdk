/**
 * Reasoning chain types
 */

/** Reasoning step in a chain */
export interface IReasoningStep {
  index: number;
  type: "text" | "tool_use";
  text?: string;
  metadata?: Record<string, any>;
  // Fields for tool_use type
  name?: string;
  id?: string;
  input?: string;
  output?: string;
}

/** Chain of reasoning steps */
export interface IReasoningChain {
  steps: IReasoningStep[];
  isComplete: boolean;
}

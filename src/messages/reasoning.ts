/**
 * Content block types (unified for all channels)
 */

/** Content block - can be text or tool_use */
export interface IContentBlock {
  index: number;
  type: "text" | "tool_use";
  // For type="text"
  text?: string;
  metadata?: Record<string, any>;
  // For type="tool_use"
  name?: string; // Tool name
  id?: string; // Tool ID
  input?: string; // Tool parameters (IN) - what we passed to the tool
  output?: string; // Tool result (OUT) - what the tool returned
  /** A line a client reads for the call in its own words («Studying the brand Flabelus»), set by the graph (dispatchToolLabel). */
  label?: string;
  /** The label is the call's own (dispatchToolLabel), not the tool's title. */
  labelled?: boolean;
}

/** Chain of content blocks */
export interface IContentChain {
  channel: string; // "text" | "processing"
  steps: IContentBlock[];
  isComplete: boolean;
}

// Legacy aliases for backward compatibility
export type IReasoningStep = IContentBlock;
export type IReasoningChain = IContentChain;

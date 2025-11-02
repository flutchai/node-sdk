/**
 * Message tracing types
 */

export type TracingLevel = "info" | "warn" | "error" | "debug";

/** Active tool call during streaming */
export interface IToolCall {
  name: string;
  id?: string;
  input?: any;
}

/** Tracing event from graph execution */
export interface ITracingEvent {
  node: string;
  type: string;
  timestamp: number;
  level: TracingLevel;
  message: string;
  data?: any;
  error?: string;
}

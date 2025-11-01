/**
 * Message tracing types
 */

/** Active tool call during streaming */
export interface IToolCall {
  name: string;
  id?: string;
  input?: any;
}

/** Tracing event from graph execution */
export interface ITracingEvent {
  timestamp: string;
  type: string;
  data?: Record<string, any>;
}

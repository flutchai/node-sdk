/**
 * Graph tracing types
 */

export interface IGraphTraceEvent {
  type: string;
  name?: string;
  channel?: string;
  nodeName?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

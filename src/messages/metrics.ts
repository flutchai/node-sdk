/**
 * Usage metrics types
 */

/** Usage metrics */
export interface IUsageMetrics {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  [key: string]: any;
}

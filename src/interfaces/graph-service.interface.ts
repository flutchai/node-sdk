// packages/sdk/src/interfaces/graph-service.interface.ts
import { HumanMessage } from "@langchain/core/messages";
import { CallbackResult } from "./callback.interface";
import {
  IAttachment,
  IUsageMetrics,
  IReasoningChain,
  IStoredMessageContent,
} from "../shared-types";
export {
  IStoredMessageContent,
  IAttachment,
  IUsageMetrics,
  IReasoningChain,
} from "../shared-types";
// Minimal interfaces required for data exchange.
// In the main system they can be extended with richer types.

/**
 * Base contract for all graph services
 */
export interface IGraphService {
  /**
   * Check service availability
   */
  healthCheck(): Promise<boolean>;

  /**
   * Get list of supported graph types
   */
  getSupportedGraphTypes(): Promise<string[]>;

  /**
   * Generate answer (without streaming)
   */
  generateAnswer(payload: IGraphRequestPayload): Promise<IGraphResponsePayload>;

  /**
   * Stream answer generation
   */
  streamAnswer(
    payload: IGraphRequestPayload,
    onPartial: (chunk: string) => void
  ): Promise<IGraphResponsePayload>;

  /**
   * Cancel generation
   */
  cancelGeneration(requestId: string): Promise<void>;

  /**
   * Execute callback
   */
  executeCallback(
    token: string,
    platform?: string,
    platformContext?: any
  ): Promise<CallbackResult>;
}

/**
 * Request to graph service
 */
export interface IGraphRequestPayload {
  /**
   * Unique request ID
   */
  requestId: string;

  /**
   * Thread ID
   */
  threadId: string;

  /**
   * User ID
   */
  userId: string;

  /**
   * Agent ID
   */
  agentId: string;

  /**
   * User message
   */
  message: HumanMessage;

  /**
   * Graph type
   */
  graphType: string;

  /**
   * Graph settings ID
   */
  graphSettings: any;

  /**
   * Additional context (message history, etc)
   */
  context?: Record<string, any>;

  metadata?: Record<string, any>;
}

/**
 * Response from graph service
 */
export interface IGraphResponsePayload {
  /**
   * Request ID
   */
  requestId: string;

  /**
   * Response text
   */
  text: string;

  /**
   * Attachments
   */
  attachments?: IAttachment[];

  /**
   * Reasoning chains
   */
  reasoningChains?: IReasoningChain[];

  /**
   * Metadata
   */
  metadata: {
    /**
     * Usage metrics (tokens, etc.)
     */
    usageMetrics: IUsageMetrics;

    /**
     * Other metadata
     */
    [key: string]: any;
  };
}

/**
 * Constants for injection tokens
 */
export const GraphServiceTokens = {
  REGISTRY: "GRAPH_SERVICE_REGISTRY",
  CLIENT: "GRAPH_SERVICE_CLIENT",
  SETTINGS_REPOSITORY: "GRAPH_SERVICE_SETTINGS_REPOSITORY",
};

/**
 * Repository for graph settings
 */
export interface IGraphSettingsRepository {
  /**
   * Get graph settings by ID
   */
  getSettings(settingsId: string): Promise<any>;

  /**
   * Get graph settings by agent and graph type
   */
  getSettingsByAgentAndType(agentId: string, graphType: string): Promise<any>;

  /**
   * Save graph settings
   */
  saveSettings(
    agentId: string,
    graphType: string,
    settings: any
  ): Promise<string>;
}

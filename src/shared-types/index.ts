/**
 * Shared type definitions for service mesh
 */

// ============================================================================
// Base Entity Interfaces
// ============================================================================

export interface IDeletionInfo {
  deletedAt: Date;
  deletedBy: string;
  reason?: string;
}

export interface IBaseEntity {
  id: string;
  version: number;
  createdAt?: Date;
  updatedAt?: Date;
  deletion?: IDeletionInfo;
}

// ============================================================================
// Model Catalog Enums
// ============================================================================

export enum ModelProvider {
  FLUTCH = "flutch",
  FLUTCH_MISTRAL = "flutch-mistral",
  FLUTCH_OPENAI = "flutch-openai",
  FLUTCH_ANTHROPIC = "flutch-anthropic",
  MISTRAL = "mistral",
  OPENAI = "openai",
  ANTHROPIC = "anthropic",
  AWS = "aws",
  COHERE = "cohere",
  VOYAGEAI = "voyageai",
}

export enum ModelType {
  CHAT = "chat", // LLM for text generation
  RERANK = "rerank", // Cross-encoder for document reranking
  EMBEDDING = "embedding", // Models for vectorization
  IMAGE = "image", // Models for image generation
  SPEECH = "speech", // Models for TTS/STT
}

export enum ChatFeature {
  STREAMING = "streaming",
  TOOLS = "tools",
  VISION = "vision",
  FUNCTION_CALLING = "function_calling",
  JSON_MODE = "json_mode",
}

// ============================================================================
// Tool Catalog Interfaces
// ============================================================================

/**
 * Tool definition in catalog
 */
export interface IToolCatalog extends IBaseEntity {
  /** Tool name used in code (e.g., "web_search", "datetime") */
  toolName: string;
  /** Display title for UI */
  title: string;
  /** Brief description */
  description?: string;
  /** Tool category (e.g., "github", "slack", "sheets", "utilities") */
  category?: string;
  /** Is tool active and available */
  isActive: boolean;
  /** Tool version string */
  toolVersion?: string;
  /** Configuration schema for tool parameters */
  configSchema?: IToolConfigOption[];
}

/**
 * Tool configuration option definition
 */
export interface IToolConfigOption {
  key: string;
  name: string;
  description?: string;
  type:
    | "string"
    | "number"
    | "boolean"
    | "select"
    | "kbselect"
    | "modelSelector"
    | "text"
    | "textarea";
  required?: boolean;
  defaultValue?: any;
  options?: Array<{ value: string; label: string }>;
  params?: {
    isMulti?: boolean;
    minimum?: number;
    maximum?: number;
    placeholder?: string;
    maxLength?: number;
    modelType?: ModelType;
    provider?: ModelProvider;
    isActive?: boolean;
  };
}

/**
 * Agent's tool configuration
 */
export interface IAgentToolConfig {
  /** Tool name from catalog */
  toolName: string;
  /** Is enabled for this agent */
  enabled: boolean;
  /** Custom configuration values */
  config?: Record<string, any>;
}

/**
 * Agent tool configuration with credential management
 */
export interface IAgentToolConfiguration {
  /** Tool name from catalog */
  toolName: string;
  /** Is enabled for this agent */
  enabled: boolean;
  /** Agent-specific configuration values */
  config?: Record<string, any>;
  /** Authentication credentials (encrypted) */
  credentials?: Record<string, string>;
  /** Use global credentials instead of agent-specific */
  useGlobalCredentials?: boolean;
}

/**
 * System-wide tool credentials (stored securely)
 */
export interface ISystemToolCredentials {
  /** Tool name */
  toolName: string;
  /** Encrypted credentials */
  credentials: Record<string, string>;
  /** Created by user ID */
  createdBy: string;
  /** Created timestamp */
  createdAt: Date;
  /** Last updated timestamp */
  updatedAt: Date;
}

/**
 * Tool execution context with resolved credentials
 */
export interface IToolExecutionContext {
  /** Tool name */
  toolName: string;
  /** Resolved configuration */
  config: Record<string, any>;
  /** Resolved credentials (decrypted) */
  credentials: Record<string, string>;
  /** Agent ID executing the tool */
  agentId: string;
  /** User ID */
  userId: string;
}

// ============================================================================
// Vector Store / Retriever Enums
// ============================================================================

export enum RetrieverSearchType {
  Search = "search",
  MMR = "mmr",
  Similarity = "similarity",
}

// ============================================================================
// Message / Attachment Enums
// ============================================================================

export enum AttachmentType {
  IMAGE = "image",
  VOICE = "voice",
  FILE = "file",
  BUTTON = "button",
  CITATION = "citation",
  SUGGESTION = "suggestion",
  WEBAPP = "webapp",
  SOURCE = "source",
  CARD = "card",
  CHART = "chart",
}

// ============================================================================
// Message Content Interfaces
// ============================================================================

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

/** Attachment interface */
export interface IAttachment {
  type: AttachmentType;
  value: any;
  metadata?: Record<string, any>;
}

/** Usage metrics */
export interface IUsageMetrics {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  [key: string]: any;
}

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

// ============================================================================
// Streaming Enums
// ============================================================================

export enum StreamChannel {
  TEXT = "text",
  PROCESSING = "processing",
  TOOLS = "tools",
}

// ============================================================================
// Graph Trace Interfaces
// ============================================================================

export interface IGraphTraceEvent {
  type: string;
  name?: string;
  channel?: string;
  nodeName?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

// ============================================================================
// Attachment Value Types
// ============================================================================

export type CitationValue = {
  source: {
    url: string;
    title: string;
    type: "webpage" | "pdf" | "article";
    articleId?: string;
    knowledgeBaseId?: string;
  };
};

// ============================================================================
// Chart Types
// ============================================================================

export type ChartType = "line" | "bar" | "pie" | "area";

export interface IChartDataPoint {
  label: string;
  value: number;
  color?: string;
}

export interface IChartDataset {
  label: string;
  data: IChartDataPoint[];
  color?: string;
}

export interface IChartValue {
  type: ChartType;
  title: string;
  description?: string;
  datasets: IChartDataset[];
  options?: {
    showLegend?: boolean;
    showGrid?: boolean;
    currency?: boolean;
    percentage?: boolean;
    [key: string]: any;
  };
}

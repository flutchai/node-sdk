// packages/graph-service-core/src/interfaces/graph-types.ts

// Interfaces to avoid circular dependencies
export interface IGraphTracer {
  log(data: any): void;
  error(data: any): void;
  // Will extend as needed
}

export interface IUsageRecorder {
  recordModelExecution(record: any): void;
  // Will extend as needed
}
import {
  BaseChannel,
  CompiledStateGraph,
  StateType,
  LangGraphRunnableConfig,
  Annotation,
} from "@langchain/langgraph";

// MappedChannels and other base types
export type MappedChannels<T> = {
  [K in keyof T]: BaseChannel<T[K], T[K]>;
};

// Global registry of graph types - extended via declare global in each graph
declare global {
  namespace GraphTypes {
    interface Registry {
      // Base structure - will be extended in specific graph modules
    }
  }
}

// Export alias for convenience
export type IGraphTypeRegistry = GraphTypes.Registry;

// Base interface for any graph type (for dynamic types)
export interface IGenericGraphType {
  Params: any;
  State: any;
  Config: any;
  Input: any;
  Definition: any;
  ConfigDefinition: any;
  InputDefinition: any;
  StateValues: any;
  ConfigValues: any;
  InputValues: any;
  OutputValues: any;
}

// Type-safe compiled graph with fallback for unknown types
export type CompiledGraphFor<T extends string> =
  T extends keyof IGraphTypeRegistry
    ? CompiledStateGraph<
        IGraphTypeRegistry[T]["State"],
        IGraphTypeRegistry[T]["State"],
        string,
        IGraphTypeRegistry[T]["Input"],
        IGraphTypeRegistry[T]["State"],
        IGraphTypeRegistry[T]["Config"]
      >
    : CompiledStateGraph<any, any, string, any, any, any>;

// Base interface for graph builders
export interface IGraphBuilder<T extends string> {
  buildGraph(config?: any): Promise<CompiledGraphFor<T>>;
}

// Graph compiler interface
export interface IGraphCompiler {
  getConfiguredGraph<T extends string>(
    type: T,
    thread?: any // IThreadCompletion - optional for backward compatibility
  ): Promise<CompiledGraphFor<T>>;
}

// Base graph state. Specific implementations can
// extend it and add any fields.
export type BaseGraphState = {};

// Standard metadata structure for all graphs
export interface IGraphMetadata {
  userId: string;
  applicationId: string;
  workflowType: string;
  version: string;
}

// Standard configurable structure for all graphs
export interface IGraphConfigurable<TGraphSettings = any> {
  thread_id?: string;
  metadata?: IGraphMetadata;
  graphSettings: TGraphSettings;
}

// Typed RunnableConfig with our metadata based on LangGraphRunnableConfig
export type IGraphRunnableConfig<TGraphSettings = any> =
  LangGraphRunnableConfig<IGraphConfigurable<TGraphSettings>> & {
    configurable: IGraphConfigurable<TGraphSettings>; // override as required
  };

// Strict type for use in graph nodes - configurable and context are required
export type StrictGraphRunnableConfig<TGraphSettings = any> =
  LangGraphRunnableConfig<TGraphSettings> & {
    configurable: IGraphConfigurable<TGraphSettings>;
  };

// Shared LLM Configuration Interface for all graphs
export interface LLMConfig {
  modelId: string;
  temperature?: number;
  maxTokens?: number;
  prompt?: string;
}

// Metadata for graphs (for frontend)
export interface IGraphTypeMetadata {
  type: string;
  metadata: {
    title: string;
    description: string;
    detailedDescription: string;
    icon?: string;
    recommendations?: string[];
    tags?: string[];
    category?: string;
  };
  schema: {
    // JSON Schema for graph settings
    properties: Record<string, any>;
    required: string[];
  };
  defaultSettings: any;
  formFields?: any[]; // Form field definitions for UI rendering
}

// Registry of graph metadata for frontend
export type IGraphMetadataRegistry = Record<string, IGraphTypeMetadata>;
export { StreamChannel } from "../shared-types";

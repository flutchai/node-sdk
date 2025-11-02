import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { BaseDocumentCompressor } from "@langchain/core/retrievers/document_compressors";
import { Embeddings } from "@langchain/core/embeddings";
import { ModelType } from "./enums";
import { ModelByIdConfig, ModelConfigWithToken } from "./llm.types";

// Universal model types
export type Model = BaseChatModel | BaseDocumentCompressor | Embeddings;

// Configuration with model type
export interface ModelByIdWithTypeConfig extends ModelByIdConfig {
  modelType: ModelType;
}

// Extended model configuration with type
export interface ModelConfigWithTokenAndType extends ModelConfigWithToken {
  modelType: ModelType;
  // Additional fields for specific types
  maxDocuments?: number;
  dimensions?: number;
  supportedFormats?: string[];
}

// Universal interface for initializing different model types
export interface IModelInitializer {
  // Typed methods for each model type
  createChatModelById(modelId: string): Promise<BaseChatModel>;
  createRerankModelById(modelId: string): Promise<BaseDocumentCompressor>;
  createEmbeddingModelById(modelId: string): Promise<Embeddings>;

  // Universal method - automatically determines type by modelId
  createModelById(modelId: string, expectedType?: ModelType): Promise<Model>;

  // Legacy methods for backward compatibility
  initializeChatModel(config: ModelByIdConfig): Promise<BaseChatModel>;
  initializeRerankModel(
    config: ModelByIdConfig
  ): Promise<BaseDocumentCompressor>;
  initializeEmbeddingModel(config: ModelByIdConfig): Promise<Embeddings>;
  initializeModelByType(config: ModelByIdWithTypeConfig): Promise<Model>;

  // Method to get configuration with type
  getModelConfigWithType(modelId: string): Promise<ModelConfigWithTokenAndType>;

  // Check if model type is supported
  isModelTypeSupported(modelType: ModelType): boolean;

  // Get available model types
  getSupportedModelTypes(): ModelType[];
}

// Types for creating different model types
export type ChatModelCreator = (
  config: ModelConfigWithTokenAndType
) => BaseChatModel;
export type RerankModelCreator = (
  config: ModelConfigWithTokenAndType
) => BaseDocumentCompressor;
export type EmbeddingModelCreator = (
  config: ModelConfigWithTokenAndType
) => Embeddings;

// Mapping of model creators by type
export interface ModelCreators {
  [ModelType.CHAT]: ChatModelCreator;
  [ModelType.RERANK]: RerankModelCreator;
  [ModelType.EMBEDDING]: EmbeddingModelCreator;
  // Types that are not yet supported
  [ModelType.IMAGE]?: never;
  [ModelType.SPEECH]?: never;
}

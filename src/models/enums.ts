/**
 * Model-related enums
 */

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

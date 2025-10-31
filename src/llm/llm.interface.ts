import { LLModel, ModelConfig, ModelByIdConfig } from "./llm.types";

export interface ILLMInitializer {
  // Legacy method for backward compatibility
  initializeModel(config: ModelConfig): LLModel;

  // New method for initialization by model ID
  initializeModelById(config: ModelByIdConfig): Promise<LLModel>;

  check(): string;
}

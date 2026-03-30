/**
 * Pure business logic for ModelInitializer — no I/O, no DI, no LangChain imports.
 * Easily testable without mocks.
 */

import { createHash } from "crypto";
import { IAgentToolConfig } from "../tools/config";
import { ToolConfig } from "./llm.types";

/**
 * Check if a model name refers to a "reasoning model" that requires
 * maxCompletionTokens instead of maxTokens, and temperature = 1.
 */
export function isReasoningModel(modelName: string): boolean {
  return (
    modelName.includes("gpt-5") ||
    modelName.includes("gpt-o1") ||
    modelName.includes("gpt-o2") ||
    modelName.includes("gpt-o3") ||
    modelName.includes("gpt-o4") ||
    /^gpt-(5|6|7|8|9)/.test(modelName) ||
    /^gpt-o[1-4]/.test(modelName)
  );
}

/**
 * Generate a stable MD5-based hash of a tools configuration array.
 * Used as part of the model instance cache key.
 */
export function hashToolsConfig(toolsConfig: IAgentToolConfig[]): string {
  const sorted = toolsConfig
    .map(t => `${t.toolName}:${t.enabled}:${JSON.stringify(t.config || {})}`)
    .sort()
    .join("|");

  return createHash("md5").update(sorted).digest("hex").slice(0, 16);
}

/**
 * Normalize flexible ToolConfig[] (from graph configs) into IAgentToolConfig[] (SDK internal format).
 */
export function normalizeToolConfigs(
  tools?: ToolConfig[]
): IAgentToolConfig[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map(t =>
    typeof t === "string"
      ? { toolName: t, enabled: true }
      : { toolName: t.name, enabled: t.enabled !== false, config: t.config }
  );
}

export const DEFAULT_ROUTER_URL = "https://router.flutch.ai";

/**
 * Resolve the router base URL.
 * Priority: explicit baseURL arg > FLUTCH_ROUTER_URL env > DEFAULT_ROUTER_URL.
 */
export function resolveRouterURL(baseURL?: string): string {
  return baseURL ?? process.env.FLUTCH_ROUTER_URL ?? DEFAULT_ROUTER_URL;
}

/**
 * Generate a cache key for a model instance.
 * Format: "modelId:temperature:maxTokens[:baseURL][:toolsHash]"
 */
export function generateModelCacheKey(
  modelId: string,
  temperature?: number,
  maxTokens?: number,
  toolsConfig?: IAgentToolConfig[],
  baseURL?: string
): string {
  const parts: (string | number)[] = [
    modelId,
    temperature ?? "default",
    maxTokens ?? "default",
  ];

  if (baseURL) {
    parts.push(baseURL);
  }

  if (toolsConfig && toolsConfig.length > 0) {
    parts.push(hashToolsConfig(toolsConfig));
  }

  return parts.join(":");
}

/**
 * Build the constructor config object for a ChatOpenAI instance.
 * Returns different shapes for reasoning models (GPT-5+) vs legacy models.
 */
export function buildOpenAIModelConfig(
  modelName: string,
  temperature: number,
  maxTokens: number,
  apiToken: string
): Record<string, any> {
  if (isReasoningModel(modelName)) {
    return {
      modelName,
      temperature: 1, // Reasoning models only support temperature=1
      maxCompletionTokens: maxTokens,
      streaming: true,
      openAIApiKey: apiToken,
    };
  }

  return {
    modelName,
    temperature,
    maxTokens,
    streaming: true,
    openAIApiKey: apiToken,
  };
}

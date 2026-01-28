import {
  isReasoningModel,
  hashToolsConfig,
  generateModelCacheKey,
  buildOpenAIModelConfig,
} from "../models/model.logic";
import { IAgentToolConfig } from "../tools/config";

describe("model.logic", () => {
  describe("isReasoningModel", () => {
    it.each([
      "gpt-5",
      "gpt-5-turbo",
      "gpt-5-0125",
      "gpt-6",
      "gpt-7-preview",
      "gpt-o1",
      "gpt-o2",
      "gpt-o3",
      "gpt-o4-mini",
    ])('should return true for "%s"', name => {
      expect(isReasoningModel(name)).toBe(true);
    });

    it.each([
      "gpt-4",
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-3.5-turbo",
      "claude-3-sonnet",
      "mistral-large",
    ])('should return false for "%s"', name => {
      expect(isReasoningModel(name)).toBe(false);
    });
  });

  describe("hashToolsConfig", () => {
    it("should return a 16-char hex string", () => {
      const config: IAgentToolConfig[] = [
        { toolName: "search", enabled: true },
      ];
      const hash = hashToolsConfig(config);

      expect(hash).toHaveLength(16);
      expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });

    it("should be deterministic", () => {
      const config: IAgentToolConfig[] = [
        { toolName: "search", enabled: true, config: { limit: 10 } },
      ];
      expect(hashToolsConfig(config)).toBe(hashToolsConfig(config));
    });

    it("should be order-independent", () => {
      const a: IAgentToolConfig[] = [
        { toolName: "b", enabled: true },
        { toolName: "a", enabled: false },
      ];
      const b: IAgentToolConfig[] = [
        { toolName: "a", enabled: false },
        { toolName: "b", enabled: true },
      ];
      expect(hashToolsConfig(a)).toBe(hashToolsConfig(b));
    });

    it("should differ for different configs", () => {
      const a: IAgentToolConfig[] = [{ toolName: "x", enabled: true }];
      const b: IAgentToolConfig[] = [{ toolName: "x", enabled: false }];
      expect(hashToolsConfig(a)).not.toBe(hashToolsConfig(b));
    });
  });

  describe("generateModelCacheKey", () => {
    it("should produce modelId:temp:maxTokens format", () => {
      expect(generateModelCacheKey("m1", 0.7, 4096)).toBe("m1:0.7:4096");
    });

    it("should use 'default' for undefined values", () => {
      expect(generateModelCacheKey("m1")).toBe("m1:default:default");
    });

    it("should append tools hash when toolsConfig provided", () => {
      const tools: IAgentToolConfig[] = [{ toolName: "search", enabled: true }];
      const key = generateModelCacheKey("m1", 0.7, 4096, tools);

      expect(key).toMatch(/^m1:0\.7:4096:[a-f0-9]{16}$/);
    });

    it("should not append hash for empty toolsConfig", () => {
      expect(generateModelCacheKey("m1", 0.5, 1024, [])).toBe("m1:0.5:1024");
    });
  });

  describe("buildOpenAIModelConfig", () => {
    it("should use maxTokens for legacy models", () => {
      const config = buildOpenAIModelConfig("gpt-4o", 0.7, 4096, "sk-test");

      expect(config.maxTokens).toBe(4096);
      expect(config.maxCompletionTokens).toBeUndefined();
      expect(config.temperature).toBe(0.7);
      expect(config.streaming).toBe(true);
      expect(config.openAIApiKey).toBe("sk-test");
    });

    it("should use maxCompletionTokens for reasoning models", () => {
      const config = buildOpenAIModelConfig(
        "gpt-5-turbo",
        0.7,
        4096,
        "sk-test"
      );

      expect(config.maxCompletionTokens).toBe(4096);
      expect(config.maxTokens).toBeUndefined();
      expect(config.temperature).toBe(1); // forced
    });

    it("should force temperature=1 for GPT-5", () => {
      const config = buildOpenAIModelConfig("gpt-5", 0.2, 2048, "key");
      expect(config.temperature).toBe(1);
    });

    it("should preserve custom temperature for legacy models", () => {
      const config = buildOpenAIModelConfig("gpt-4", 0.3, 1024, "key");
      expect(config.temperature).toBe(0.3);
    });
  });
});

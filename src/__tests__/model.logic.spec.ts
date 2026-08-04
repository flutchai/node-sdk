import {
  isReasoningModel,
  hashToolsConfig,
  generateModelCacheKey,
  buildOpenAIModelConfig,
  normalizeToolConfigs,
  modelAcceptsSamplingParams,
  resolveSamplingParams,
  toOptionalNumber,
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

  describe("normalizeToolConfigs", () => {
    it("returns undefined for undefined input", () => {
      expect(normalizeToolConfigs(undefined)).toBeUndefined();
    });

    it("returns undefined for empty array", () => {
      expect(normalizeToolConfigs([])).toBeUndefined();
    });

    it("normalizes string tools", () => {
      expect(normalizeToolConfigs(["tool1", "tool2"])).toEqual([
        { toolName: "tool1", enabled: true },
        { toolName: "tool2", enabled: true },
      ]);
    });

    it("normalizes object tools", () => {
      expect(
        normalizeToolConfigs([
          { name: "tool1", enabled: true, config: { key: "val" } },
          { name: "tool2", enabled: false },
        ])
      ).toEqual([
        { toolName: "tool1", enabled: true, config: { key: "val" } },
        { toolName: "tool2", enabled: false, config: undefined },
      ]);
    });

    it("normalizes mixed string and object tools", () => {
      expect(
        normalizeToolConfigs([
          "string_tool",
          { name: "object_tool", config: { x: 1 } },
        ])
      ).toEqual([
        { toolName: "string_tool", enabled: true },
        { toolName: "object_tool", enabled: true, config: { x: 1 } },
      ]);
    });

    it("defaults enabled to true for object tools without enabled field", () => {
      expect(normalizeToolConfigs([{ name: "tool1" }])).toEqual([
        { toolName: "tool1", enabled: true, config: undefined },
      ]);
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

    it("should omit the temperature key entirely when undefined", () => {
      const config = buildOpenAIModelConfig("gpt-4", undefined, 1024, "key");
      expect(config).not.toHaveProperty("temperature");
      expect(config.maxTokens).toBe(1024);
    });
  });

  describe("toOptionalNumber", () => {
    it.each([
      [0.7, 0.7],
      [0, 0],
      ["0.5", 0.5],
    ])("should convert %p to %p", (input, expected) => {
      expect(toOptionalNumber(input)).toBe(expected);
    });

    it.each([undefined, null, "", "not-a-number", NaN, Infinity])(
      "should return undefined for %p (never NaN)",
      input => {
        expect(toOptionalNumber(input)).toBeUndefined();
      }
    );
  });

  describe("modelAcceptsSamplingParams", () => {
    // Claude Opus 4.7+ and the whole Claude 5 generation reject
    // temperature / top_p / top_k.
    it.each([
      "claude-opus-4-7",
      "claude-opus-4-8",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-5",
      "claude-fable-5",
      "claude-mythos-5",
      "us.anthropic.claude-opus-4-7",
      "us.anthropic.claude-opus-4-7-20260101-v1:0",
      "eu.anthropic.claude-sonnet-5",
      "apac.anthropic.claude-opus-5-20260401-v1:0",
      "anthropic.claude-opus-4-8",
      "claude-opus-4-7@20260101", // Vertex-style
      "CLAUDE-OPUS-5", // case-insensitive
      "claude-opus-6", // future major
      "claude-sonnet-6-1", // future minor
    ])('should return false for "%s"', name => {
      expect(modelAcceptsSamplingParams(name)).toBe(false);
    });

    // Everything at or below each family's threshold keeps temperature.
    it.each([
      "claude-opus-4-6",
      "claude-opus-4-5",
      "claude-opus-4",
      "claude-opus-4-20250514",
      "anthropic.claude-opus-4-20250514-v1:0",
      "claude-sonnet-4-6",
      "claude-sonnet-4-5",
      "claude-sonnet-4-5-20250929",
      "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
      "us.anthropic.claude-sonnet-4-6",
      "claude-haiku-4-5",
      "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      "claude-3-5-sonnet-20241022", // legacy naming
      "claude-3-7-sonnet-20250219",
      "us.anthropic.claude-3-5-haiku-20241022-v1:0",
      "gpt-4o",
      "gpt-5",
      "mistral-large",
      "command-r-plus",
    ])('should return true for "%s"', name => {
      expect(modelAcceptsSamplingParams(name)).toBe(true);
    });

    it("should return true for an empty/absent identifier", () => {
      expect(modelAcceptsSamplingParams(undefined)).toBe(true);
      expect(modelAcceptsSamplingParams("")).toBe(true);
    });
  });

  describe("resolveSamplingParams", () => {
    it("should pass params through for a supported model", () => {
      const result = resolveSamplingParams(["claude-sonnet-4-5"], {
        temperature: 0.7,
        topP: 0.9,
      });

      expect(result.accepted).toBe(true);
      expect(result.params).toEqual({ temperature: 0.7, topP: 0.9 });
      expect(result.dropped).toEqual([]);
    });

    it("should drop params for an unsupported model and report them", () => {
      const result = resolveSamplingParams(["claude-opus-5"], {
        temperature: 0.7,
        topP: 0.9,
      });

      expect(result.accepted).toBe(false);
      expect(result.params).toEqual({});
      expect(result.dropped).toEqual(["temperature", "topP"]);
    });

    it("should drop when ANY of the identifiers is an unsupported model", () => {
      const result = resolveSamplingParams(
        ["claude-opus-latest", "us.anthropic.claude-opus-5"],
        { temperature: 0.7 }
      );

      expect(result.accepted).toBe(false);
      expect(result.params).toEqual({});
    });

    it("should ignore undefined identifiers", () => {
      const result = resolveSamplingParams(["claude-sonnet-4-5", undefined], {
        temperature: 0.7,
      });

      expect(result.accepted).toBe(true);
      expect(result.params.temperature).toBe(0.7);
    });

    it("should report nothing dropped when no params were requested", () => {
      const result = resolveSamplingParams(["claude-opus-5"], {});

      expect(result.accepted).toBe(false);
      expect(result.dropped).toEqual([]);
    });

    it("should let supportsSamplingParams=true force params through", () => {
      const result = resolveSamplingParams(
        ["claude-opus-5"],
        { temperature: 0.7 },
        true
      );

      expect(result.accepted).toBe(true);
      expect(result.params.temperature).toBe(0.7);
    });

    it("should let supportsSamplingParams=false suppress params", () => {
      const result = resolveSamplingParams(
        ["claude-sonnet-4-5"],
        { temperature: 0.7 },
        false
      );

      expect(result.accepted).toBe(false);
      expect(result.params).toEqual({});
      expect(result.dropped).toEqual(["temperature"]);
    });

    it("should preserve temperature=0 (not treated as absent)", () => {
      const result = resolveSamplingParams(["claude-sonnet-4-5"], {
        temperature: 0,
      });

      expect(result.params).toEqual({ temperature: 0 });
    });
  });
});

import { DynamicStructuredTool, StructuredTool } from "@langchain/core/tools";
import { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";
import axios from "axios";
import { Logger } from "@nestjs/common";
import { zodToJsonSchema } from "zod-to-json-schema";
import { McpTool } from "./mcp.interfaces";
import { IGraphConfigurable } from "../graph/graph-types";

interface ToolExecutionRequest {
  name: string;
  arguments: Record<string, any>;
  context?: {
    agentId?: string;
    userId?: string;
    threadId?: string;
  };
}

interface ToolExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
}

/**
 * Converts MCP tools to LangChain DynamicStructuredTools with proper schema support
 */
type LangChainStructuredTool = StructuredTool<any, any, any, string>;

export class McpConverter {
  private readonly logger = new Logger(McpConverter.name);
  private readonly mcpRuntimeUrl: string;

  constructor(mcpRuntimeUrl: string = "http://localhost:3004") {
    this.mcpRuntimeUrl = mcpRuntimeUrl;
    this.logger.log(
      `🔧 McpConverter initialized with SDK version 0.1.8 (manual jsonSchemaToZod)`
    );
  }

  /**
   * Convert JSON Schema to Zod schema manually
   * This creates a standard Zod schema that zodToJsonSchema can convert back properly
   */
  private jsonSchemaToZod(jsonSchema: any): z.ZodTypeAny {
    if (!jsonSchema || typeof jsonSchema !== "object") {
      return z.any();
    }

    try {
      // Handle object type with properties
      if (jsonSchema.type === "object" && jsonSchema.properties) {
        const shape: Record<string, z.ZodTypeAny> = {};

        for (const [key, propSchema] of Object.entries(jsonSchema.properties)) {
          const prop = propSchema as any;
          let zodProp: z.ZodTypeAny;

          // Convert property based on type
          switch (prop.type) {
            case "string":
              zodProp = z.string();
              break;
            case "number":
              zodProp = z.number();
              break;
            case "boolean":
              zodProp = z.boolean();
              break;
            case "integer":
              zodProp = z.number().int();
              break;
            case "array":
              zodProp = z.array(z.any());
              break;
            case "object":
              zodProp = z.record(z.any());
              break;
            default:
              zodProp = z.any();
          }

          // Add description if present
          if (prop.description) {
            zodProp = zodProp.describe(prop.description);
          }

          // Make optional if not in required array
          if (!jsonSchema.required?.includes(key)) {
            zodProp = zodProp.optional();
          }

          shape[key] = zodProp;
        }

        return z.object(shape);
      }

      // Fallback to z.any() for other types
      this.logger.warn(
        `Unsupported JSON Schema structure, falling back to z.any()`
      );
      return z.any();
    } catch (error) {
      this.logger.warn(
        `Failed to convert JSON Schema, falling back to z.any(): ${error}`
      );
      return z.any();
    }
  }

  /**
   * Convert a single MCP tool to LangChain DynamicStructuredTool
   */
  convertTool(mcpTool: McpTool): LangChainStructuredTool {
    const logger = this.logger;
    const mcpRuntimeUrl = this.mcpRuntimeUrl;

    // Enhance tool description with parameter descriptions
    // This is a workaround because zodToJsonSchema doesn't preserve .describe() properly
    let enhancedDescription = mcpTool.description;

    if (mcpTool.inputSchema?.properties) {
      const paramDescriptions: string[] = [];
      for (const [key, propSchema] of Object.entries(
        mcpTool.inputSchema.properties
      )) {
        const prop = propSchema as any;
        if (prop.description) {
          const isRequired = mcpTool.inputSchema.required?.includes(key);
          paramDescriptions.push(
            `- ${key}${isRequired ? " (required)" : ""}: ${prop.description}`
          );
        }
      }

      if (paramDescriptions.length > 0) {
        enhancedDescription = `${mcpTool.description}\n\nParameters:\n${paramDescriptions.join("\n")}`;
      }
    }

    const schema = this.jsonSchemaToZod(mcpTool.inputSchema);

    logger.debug(
      `🔧 [${mcpTool.name}] Original schema:`,
      JSON.stringify(mcpTool.inputSchema, null, 2)
    );
    logger.debug(
      `🔧 [${mcpTool.name}] Using schema type: ${(schema as any)?._def?.typeName ?? "unknown"}`
    );

    // Log converted Zod schema details to verify descriptions are preserved
    if (
      (schema as any)?._def?.shape &&
      typeof (schema as any)._def.shape === "function"
    ) {
      try {
        const shape = (schema as any)._def.shape();
        logger.debug(
          `🔧 [${mcpTool.name}] Converted Zod schema shape:`,
          JSON.stringify(
            Object.entries(shape).reduce(
              (acc, [key, val]: [string, any]) => {
                acc[key] = {
                  type: val?._def?.typeName,
                  description: val?._def?.description,
                  optional: val?._def?.typeName === "ZodOptional",
                };
                return acc;
              },
              {} as Record<string, any>
            ),
            null,
            2
          )
        );
      } catch (error) {
        logger.debug(
          `🔧 [${mcpTool.name}] Could not extract Zod schema shape: ${error}`
        );
      }
    }

    // CRITICAL CHECK: Convert Zod back to JSON Schema to see what LangChain will send to LLM
    try {
      const convertedJsonSchema = zodToJsonSchema(schema);
      logger.warn(
        `🔧 [${mcpTool.name}] JSON Schema that LangChain will use:`,
        JSON.stringify(convertedJsonSchema, null, 2)
      );
    } catch (error) {
      logger.warn(
        `🔧 [${mcpTool.name}] Could not convert Zod to JSON Schema: ${error}`
      );
    }

    return new DynamicStructuredTool<
      z.ZodTypeAny,
      Record<string, any>,
      any,
      string
    >({
      name: mcpTool.name,
      description: enhancedDescription,
      schema,
      func: async (
        input: Record<string, any>,
        _runManager,
        config?: RunnableConfig
      ): Promise<string> => {
        logger.log(`🔧 [${mcpTool.name}] LLM INPUT: ${JSON.stringify(input)}`);

        // Extract context from RunnableConfig.configurable
        const configurable = config?.configurable as
          | IGraphConfigurable
          | undefined;
        const context = {
          agentId: configurable?.agentId,
          userId: configurable?.userId,
          threadId: configurable?.thread_id,
        };

        logger.debug(
          `🔧 [${mcpTool.name}] Execution context: ${JSON.stringify(context)}`
        );

        try {
          const request: ToolExecutionRequest = {
            name: mcpTool.name,
            arguments: input ?? {},
            context,
          };

          logger.log(`🔧 [${mcpTool.name}] Calling MCP Runtime...`);

          const response = await axios.post(
            `${mcpRuntimeUrl}/tools/execute`,
            request,
            { timeout: 30000 }
          );

          const result: ToolExecutionResult = response.data;
          logger.log(
            `🔧 [${mcpTool.name}] MCP Runtime response: success=${result.success}`
          );

          if (!result.success) {
            const errorMessage = result.error || "Tool execution failed";
            logger.error(
              `🔧 [${mcpTool.name}] MCP Runtime error: ${errorMessage}`
            );
            throw new Error(errorMessage);
          }

          const output =
            typeof result.result === "string"
              ? result.result
              : JSON.stringify(result.result, null, 2);

          logger.log(
            `🔧 [${mcpTool.name}] TOOL OUTPUT: ${output.length > 200 ? output.substring(0, 200) + "..." : output}`
          );

          return output;
        } catch (error) {
          logger.error(
            `🔧 [${mcpTool.name}] Exception during execution`,
            error
          );
          if (axios.isAxiosError(error)) {
            throw new Error(`MCP Runtime error: ${error.message}`);
          }
          throw error instanceof Error ? error : new Error(String(error));
        }
      },
    }) as unknown as LangChainStructuredTool;
  }

  /**
   * Convert multiple MCP tools to LangChain tools
   */
  async convertTools(mcpTools: McpTool[]): Promise<LangChainStructuredTool[]> {
    return mcpTools.map(tool => this.convertTool(tool));
  }

  /**
   * Fetch and convert tools from MCP Runtime
   */
  async fetchAndConvertTools(
    filter?: string
  ): Promise<LangChainStructuredTool[]> {
    try {
      const params = filter ? { filter } : {};
      const response = await axios.get(`${this.mcpRuntimeUrl}/tools/list`, {
        params,
        timeout: 5000,
      });

      const mcpTools: McpTool[] = response.data;
      this.logger.log(`Fetched ${mcpTools.length} tools from MCP Runtime`);

      return this.convertTools(mcpTools);
    } catch (error) {
      this.logger.error("Failed to fetch MCP tools:", error);
      throw new Error(`Cannot connect to MCP Runtime at ${this.mcpRuntimeUrl}`);
    }
  }

  /**
   * Health check for MCP Runtime
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await axios.get(
        `${this.mcpRuntimeUrl}/tools/health/check`,
        { timeout: 5000 }
      );
      return response.data.status === "ok";
    } catch {
      return false;
    }
  }
}

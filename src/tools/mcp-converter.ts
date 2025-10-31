import { DynamicStructuredTool, StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import axios from "axios";
import { Logger } from "@nestjs/common";
import { McpTool } from "./mcp.interfaces";

interface ToolExecutionRequest {
  name: string;
  arguments: Record<string, any>;
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
  }

  /**
   * Convert JSON Schema to simplified Zod schema for LangChain
   */
  private jsonSchemaToZod(jsonSchema: any): z.ZodTypeAny {
    if (!jsonSchema || typeof jsonSchema !== "object") {
      return z.any();
    }

    if (jsonSchema.type !== "object") {
      return this.mapPrimitiveSchema(jsonSchema.type, true);
    }

    const properties = jsonSchema.properties || {};
    const required = Array.isArray(jsonSchema.required)
      ? jsonSchema.required
      : [];

    const zodShape: Record<string, z.ZodTypeAny> = {};

    for (const [key, prop] of Object.entries(properties)) {
      const propDef = prop as Record<string, any> | undefined;
      const isRequired = required.includes(key);
      const schemaType = propDef?.type ?? "any";
      const mappedType = this.mapPrimitiveSchema(schemaType, isRequired);

      zodShape[key] = mappedType;
    }

    const baseObject = z.object(zodShape);

    const configuredObject =
      jsonSchema.additionalProperties === false
        ? baseObject.strict()
        : baseObject.passthrough();

    return configuredObject as z.ZodTypeAny;
  }

  private mapPrimitiveSchema(
    type: string | undefined,
    required: boolean
  ): z.ZodTypeAny {
    const optionalize = <T extends z.ZodTypeAny>(
      schema: T
    ): T | z.ZodOptional<T> => (required ? schema : schema.optional());

    switch (type) {
      case "string":
        return optionalize(z.string());
      case "number":
      case "integer":
        return optionalize(z.number());
      case "boolean":
        return optionalize(z.boolean());
      case "array":
        return optionalize(z.array(z.any()));
      case "object":
        return optionalize(z.record(z.any()));
      default:
        return optionalize(z.any());
    }
  }

  /**
   * Convert a single MCP tool to LangChain DynamicStructuredTool
   */
  convertTool(mcpTool: McpTool): LangChainStructuredTool {
    const logger = this.logger;
    const mcpRuntimeUrl = this.mcpRuntimeUrl;

    const schema = this.jsonSchemaToZod(mcpTool.inputSchema);

    logger.debug(
      `🔧 [${mcpTool.name}] Original schema:`,
      JSON.stringify(mcpTool.inputSchema, null, 2)
    );
    logger.debug(
      `🔧 [${mcpTool.name}] Using schema type: ${(schema as any)?._def?.typeName ?? "unknown"}`
    );

    return new DynamicStructuredTool<
      z.ZodTypeAny,
      Record<string, any>,
      any,
      string
    >({
      name: mcpTool.name,
      description: mcpTool.description,
      schema,
      func: async (input: Record<string, any>): Promise<string> => {
        logger.log(`🔧 [${mcpTool.name}] LLM INPUT: ${JSON.stringify(input)}`);

        try {
          const request: ToolExecutionRequest = {
            name: mcpTool.name,
            arguments: input ?? {},
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

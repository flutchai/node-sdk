import { DynamicStructuredTool, StructuredTool } from "@langchain/core/tools";
import { RunnableConfig } from "@langchain/core/runnables";
import axios from "axios";
import { Logger } from "@nestjs/common";
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
      `🔧 McpConverter initialized (MCP JSON Schema passed through)`
    );
  }

  /**
   * The tool's own JSON Schema, ready for the model.
   *
   * It used to be rebuilt as Zod by hand, which kept only top-level primitive
   * types: a list of objects, an `anyOf`, a `$ref` — all became "any", and the
   * model guessed the shape (a filter list sent as one object, rejected by the
   * server). LangChain takes JSON Schema directly, so the schema now goes
   * through as is; only local `$ref`s are inlined, because not every provider
   * resolves them, and the meta keys providers reject are dropped.
   */
  static toModelSchema(inputSchema: unknown): Record<string, any> {
    const root =
      inputSchema && typeof inputSchema === "object"
        ? (inputSchema as Record<string, any>)
        : {};
    const defs: Record<string, any> = {
      ...(root.definitions ?? {}),
      ...(root.$defs ?? {}),
    };

    const resolve = (node: any, depth: number): any => {
      if (Array.isArray(node)) return node.map(item => resolve(item, depth));
      if (!node || typeof node !== "object") return node;
      if (typeof node.$ref === "string") {
        const match = /^#\/(?:\$defs|definitions)\/(.+)$/.exec(node.$ref);
        const target = match ? defs[decodeURIComponent(match[1])] : undefined;
        // An unknown or cyclic reference degrades to "any" instead of failing the tool.
        if (!target || depth > 8) return {};
        const { $ref: _ref, ...siblings } = node;
        return resolve({ ...target, ...siblings }, depth + 1);
      }
      const out: Record<string, any> = {};
      for (const [key, value] of Object.entries(node)) {
        if (key === "$defs" || key === "definitions" || key === "$schema" || key === "$id") {
          continue;
        }
        out[key] = resolve(value, depth);
      }
      return out;
    };

    const schema = resolve(root, 0);
    return {
      ...schema,
      type: "object",
      properties: schema.properties ?? {},
    };
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

    const schema = McpConverter.toModelSchema(mcpTool.inputSchema);
    logger.debug(
      `🔧 [${mcpTool.name}] Schema for the model: ${JSON.stringify(schema)}`
    );

    return new DynamicStructuredTool({
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

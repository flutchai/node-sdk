import { StructuredTool } from "@langchain/core/tools";
import { Logger } from "@nestjs/common";
import axios from "axios";
import { McpConverter } from "./mcp-converter";
import { McpTool, McpRuntimeClient } from "./mcp.interfaces";
import { IAgentToolConfig } from "./config";

/**
 * Utility for fetching and filtering MCP tools from runtime
 * Provides efficient tool filtering and conversion to LangChain tools
 */
export class McpToolFilter {
  private readonly logger = new Logger(McpToolFilter.name);
  private readonly mcpConverter: McpConverter;

  constructor(
    private readonly mcpRuntimeUrl: string = process.env.MCP_RUNTIME_URL ||
      "http://localhost:3004"
  ) {
    this.mcpConverter = new McpConverter(this.mcpRuntimeUrl);
  }

  /**
   * Fetch available tools from MCP runtime with dynamic schema generation
   * @param toolsConfig Array of tool configurations with dynamic config
   * @returns Array of LangChain Tool instances with dynamic schemas
   */
  async getFilteredTools(
    toolsConfig: IAgentToolConfig[] = []
  ): Promise<StructuredTool[]> {
    this.logger.debug(
      `[DEBUG] Getting filtered tools with dynamic schemas. Config: ${JSON.stringify(toolsConfig)}`
    );
    this.logger.debug(`[DEBUG] MCP Runtime URL: ${this.mcpRuntimeUrl}`);

    if (toolsConfig.length === 0) {
      this.logger.debug("No tools configured, returning empty array");
      return [];
    }

    try {
      // Call POST /tools/schemas with full configuration for dynamic schema generation
      this.logger.debug(
        `[DEBUG] Making HTTP POST request to: ${this.mcpRuntimeUrl}/tools/schemas`
      );
      this.logger.debug(`[DEBUG] Request body: ${JSON.stringify(toolsConfig)}`);

      const response = await axios.post(
        `${this.mcpRuntimeUrl}/tools/schemas`,
        { tools: toolsConfig },
        {
          timeout: 5000,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      this.logger.debug(
        `[DEBUG] HTTP response status: ${response.status}, data length: ${Array.isArray(response.data) ? response.data.length : "not array"}`
      );

      const dynamicTools: McpTool[] = Array.isArray(response.data)
        ? response.data
        : [];
      this.logger.debug(
        `Retrieved ${dynamicTools.length} dynamic tool schemas from MCP Runtime`
      );

      // Create a simple MCP client for tool execution
      // Note: context is passed via McpConverter which extracts it from RunnableConfig
      const mcpClient: McpRuntimeClient = {
        getTools: async () => dynamicTools,
        executeTool: async (name: string, args: any, context?: any) => {
          this.logger.debug(`[DEBUG] Executing tool ${name} with args:`, args);
          const response = await axios.post(
            `${this.mcpRuntimeUrl}/tools/execute`,
            {
              name,
              arguments: args || {},
              context,
            }
          );
          return response.data;
        },
        isHealthy: async () => true,
      };

      // Convert to LangChain tools
      this.logger.log(
        `🚀 [McpToolFilter] Converting ${dynamicTools.length} dynamic tools using McpConverter`
      );
      const tools = await this.mcpConverter.convertTools(dynamicTools);
      this.logger.log(
        `🚀 [McpToolFilter] Converted tools: ${tools.map(t => t.name).join(", ")}`
      );

      this.logger.log(
        `Configured ${tools.length} tools with dynamic schemas from MCP runtime: ${dynamicTools.map(t => t.name).join(", ")}`
      );
      return tools;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[DEBUG] Failed to fetch dynamic tool schemas from MCP runtime (${this.mcpRuntimeUrl}): ${errorMessage}`
      );
      this.logger.warn(`[DEBUG] Error details:`, {
        error,
        stack: error instanceof Error ? error.stack : "no stack",
      });
      return [];
    }
  }

  /**
   * Get all available tools without filtering
   * @returns Array of LangChain Tool instances
   */
  async getAllTools(): Promise<StructuredTool[]> {
    try {
      const response = await axios.get(`${this.mcpRuntimeUrl}/tools/list`, {
        timeout: 5000,
      });

      const allTools: McpTool[] = Array.isArray(response.data)
        ? response.data
        : [];
      this.logger.debug(`Retrieved ${allTools.length} total MCP tools`);

      const mcpClient: McpRuntimeClient = {
        getTools: async () => allTools,
        executeTool: async (name: string, args: any, context?: any) => {
          const response = await axios.post(
            `${this.mcpRuntimeUrl}/tools/execute`,
            {
              name,
              arguments: args || {},
              context,
            }
          );
          return response.data;
        },
        isHealthy: async () => true,
      };

      const tools = await this.mcpConverter.convertTools(allTools);
      this.logger.log(`Configured ${tools.length} tools from MCP runtime`);
      return tools;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to fetch all tools from MCP runtime (${this.mcpRuntimeUrl}): ${errorMessage}`
      );
      return [];
    }
  }

  /**
   * Check if MCP runtime is healthy
   * @returns boolean indicating health status
   */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await axios.get(
        `${this.mcpRuntimeUrl}/tools/health/check`,
        {
          timeout: 3000,
        }
      );
      return response.data.status === "ok";
    } catch (error) {
      this.logger.warn(
        `MCP runtime health check failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /**
   * Get available tool names from MCP runtime
   * @returns Array of tool names
   */
  async getAvailableToolNames(): Promise<string[]> {
    try {
      const response = await axios.get(`${this.mcpRuntimeUrl}/tools/list`, {
        timeout: 5000,
      });

      const tools: McpTool[] = Array.isArray(response.data)
        ? response.data
        : [];
      return tools.map(tool => tool.name);
    } catch (error) {
      this.logger.warn(
        `Failed to fetch tool names: ${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
  }
}

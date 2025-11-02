import { StructuredTool } from "@langchain/core/tools";
import { Logger } from "@nestjs/common";
import axios from "axios";
import { McpConverter } from "./mcp-converter";
import { McpTool, McpRuntimeClient } from "./mcp.interfaces";

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
   * Fetch available tools from MCP runtime with optional filtering
   * @param enabledTools Array of tool names to filter for
   * @returns Array of LangChain Tool instances
   */
  async getFilteredTools(
    enabledTools: string[] = []
  ): Promise<StructuredTool[]> {
    this.logger.debug(
      `[DEBUG] Getting filtered tools. Enabled: ${enabledTools.join(", ")}`
    );
    this.logger.debug(`[DEBUG] MCP Runtime URL: ${this.mcpRuntimeUrl}`);

    if (enabledTools.length === 0) {
      this.logger.debug("No tools enabled, returning empty array");
      return [];
    }

    try {
      // Fetch filtered tools from MCP runtime using the filter parameter
      const filterParam = enabledTools.join(",");
      this.logger.debug(
        `[DEBUG] Making HTTP request to: ${this.mcpRuntimeUrl}/tools/list with filter: ${filterParam}`
      );

      const response = await axios.get(`${this.mcpRuntimeUrl}/tools/list`, {
        params: { filter: filterParam },
        timeout: 5000,
      });

      this.logger.debug(
        `[DEBUG] HTTP response status: ${response.status}, data length: ${Array.isArray(response.data) ? response.data.length : "not array"}`
      );

      const filteredTools: McpTool[] = Array.isArray(response.data)
        ? response.data
        : [];
      this.logger.debug(
        `Retrieved ${filteredTools.length} filtered MCP tools for: ${enabledTools.join(", ")}`
      );

      // Create a simple MCP client for tool execution
      const mcpClient: McpRuntimeClient = {
        getTools: async () => filteredTools,
        executeTool: async (name: string, args: any) => {
          this.logger.debug(`[DEBUG] Executing tool ${name} with args:`, args);
          const response = await axios.post(
            `${this.mcpRuntimeUrl}/tools/execute`,
            {
              name,
              arguments: args || {},
            }
          );
          return response.data;
        },
        isHealthy: async () => true,
      };

      // Convert to LangChain tools
      this.logger.log(
        `🚀 [McpToolFilter] Converting ${filteredTools.length} tools using new McpConverter`
      );
      const tools = await this.mcpConverter.convertTools(filteredTools);
      this.logger.log(
        `🚀 [McpToolFilter] Converted tools: ${tools.map(t => t.name).join(", ")}`
      );

      this.logger.log(
        `Configured ${tools.length} tools from MCP runtime: ${filteredTools.map(t => t.name).join(", ")}`
      );
      return tools;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[DEBUG] Failed to fetch tools from MCP runtime (${this.mcpRuntimeUrl}): ${errorMessage}`
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
        executeTool: async (name: string, args: any) => {
          const response = await axios.post(
            `${this.mcpRuntimeUrl}/tools/execute`,
            {
              name,
              arguments: args || {},
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

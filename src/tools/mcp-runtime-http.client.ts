import { Injectable, Logger } from "@nestjs/common";
import axios, { AxiosInstance } from "axios";
import {
  McpTool,
  ToolExecutionResult,
  McpRuntimeClient,
} from "./mcp.interfaces";
import {
  CallbackManager,
  parseCallbackConfigArg,
} from "@langchain/core/callbacks/manager";
import { RunnableConfig } from "@langchain/core/runnables";

/**
 * HTTP client implementation for MCP Runtime
 * Provides communication with MCP Runtime service via REST API
 */
@Injectable()
export class McpRuntimeHttpClient implements McpRuntimeClient {
  private readonly logger = new Logger(McpRuntimeHttpClient.name);
  private readonly httpClient: AxiosInstance;
  private readonly baseUrl: string;

  constructor(mcpRuntimeUrl?: string) {
    this.baseUrl =
      mcpRuntimeUrl || process.env.MCP_RUNTIME_URL || "http://localhost:3004";
    this.httpClient = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000, // 30 seconds
    });

    this.logger.log(
      `MCP Runtime HTTP Client initialized with URL: ${this.baseUrl}`
    );
  }

  /**
   * Get all available tools from MCP Runtime
   */
  async getTools(): Promise<McpTool[]> {
    try {
      this.logger.debug("Fetching available tools from MCP runtime");
      const response = await this.httpClient.get("/tools/list");
      // MCP Runtime returns array of tools directly, not in wrapper object
      const tools = Array.isArray(response.data) ? response.data : [];
      this.logger.log(`Retrieved ${tools.length} tools from MCP runtime`);
      return tools;
    } catch (error) {
      this.logger.error("Failed to fetch tools from MCP runtime:", error);
      throw new Error(`Failed to fetch tools: ${error.message}`);
    }
  }

  /**
   * Execute a tool by name with given arguments
   */
  async executeTool(
    name: string,
    args: any,
    context?: any
  ): Promise<ToolExecutionResult> {
    try {
      this.logger.debug(`Executing tool: ${name} with args:`, args);

      const payload: any = {
        name,
        arguments: args || {},
      };

      // Add context if provided
      if (context) {
        payload.context = context;
      }

      const response = await this.httpClient.post("/tools/execute", payload);

      this.logger.log(`Tool ${name} executed successfully`);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to execute tool ${name}:`, error);

      // Handle axios errors
      if (error.response) {
        return {
          success: false,
          error:
            error.response.data.message ||
            error.response.data.error ||
            "Tool execution failed",
        };
      }

      return {
        success: false,
        error: error.message || "Unknown error occurred",
      };
    }
  }

  /**
   * Get tool execution statistics from MCP Runtime
   */
  async getToolStats() {
    try {
      const response = await this.httpClient.get("/tools/stats");
      return response.data;
    } catch (error) {
      this.logger.error("Failed to fetch tool stats:", error);
      return null;
    }
  }

  /**
   * Health check for MCP Runtime service
   */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.httpClient.get("/", { timeout: 5000 });
      return response.status === 200;
    } catch (error) {
      this.logger.warn("MCP Runtime health check failed:", error.message);
      return false;
    }
  }

  /**
   * Execute tool with LangChain event emission
   * @param toolCallId - Tool call ID from LLM
   * @param toolName - Tool name
   * @param enrichedArgs - Merged arguments (toolConfig + LLM args)
   * @param executionContext - Execution context (userId, agentId, etc.)
   * @param config - RunnableConfig with callbacks
   * @returns Tool execution result with content
   */
  async executeToolWithEvents(
    toolCallId: string,
    toolName: string,
    enrichedArgs: Record<string, any>,
    executionContext: Record<string, any>,
    config?: RunnableConfig
  ): Promise<{ content: string; success: boolean }> {
    // Parse callback configuration
    const parsedConfig = parseCallbackConfigArg(config);
    const callbackManager = CallbackManager.configure(parsedConfig.callbacks);

    let runManager;

    try {
      // Emit on_tool_start event
      runManager = await callbackManager?.handleToolStart(
        {
          name: toolName,
          lc: 1,
          type: "not_implemented",
          id: ["langchain", "tools", "mcp", toolName],
        },
        JSON.stringify(enrichedArgs),
        parsedConfig.runId,
        undefined,
        parsedConfig.tags,
        parsedConfig.metadata,
        toolName
      );

      // Execute tool
      const result = await this.executeTool(
        toolName,
        enrichedArgs,
        executionContext
      );

      // Create content
      const content = result.success
        ? JSON.stringify(result)
        : result.error || JSON.stringify(result);

      // Emit on_tool_end event
      await runManager?.handleToolEnd(content);

      return {
        content,
        success: result.success,
      };
    } catch (error) {
      this.logger.error(`Error executing tool ${toolName}:`, error);

      // Emit on_tool_error event
      await runManager?.handleToolError(error);

      // Return error result
      const errorContent = JSON.stringify({
        success: false,
        error:
          error instanceof Error ? error.message : "Tool execution failed",
      });

      return {
        content: errorContent,
        success: false,
      };
    }
  }
}

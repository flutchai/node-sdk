import { Injectable, Logger } from "@nestjs/common";
import axios, { AxiosInstance } from "axios";
import {
  McpTool,
  ToolExecutionResult,
  McpRuntimeClient,
} from "./mcp.interfaces";

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
}

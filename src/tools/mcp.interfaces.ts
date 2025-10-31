/**
 * MCP Tool interfaces for integration with LangChain
 */

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface ToolExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
}

export interface McpRuntimeClient {
  getTools(): Promise<McpTool[]>;
  executeTool(name: string, args: any): Promise<ToolExecutionResult>;
  isHealthy(): Promise<boolean>;
}

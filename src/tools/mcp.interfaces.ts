/**
 * MCP Tool interfaces for integration with LangChain
 */
import type { IToolUsageMetadata } from "./tool-usage";

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
  /** What the call cost, when the tool knows (see tool-usage.ts). Never shown to the model. */
  usage_metadata?: IToolUsageMetadata;
}

export interface McpRuntimeClient {
  getTools(): Promise<McpTool[]>;
  executeTool(name: string, args: any): Promise<ToolExecutionResult>;
  isHealthy(): Promise<boolean>;
}

/**
 * Data attachment for passing large tool results through graph state
 * without polluting LLM context.
 *
 * NOT related to IAttachment (shared-types/message/attachment.ts)
 * which represents UI attachments (images, charts, files) in messages.
 */
export interface IGraphAttachment {
  data: any;
  summary: string;
  toolName: string;
  toolCallId: string;
  createdAt: number;
}

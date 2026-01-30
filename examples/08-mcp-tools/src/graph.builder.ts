import { Injectable } from "@nestjs/common";
import {
  ExternalGraphBuilder,
  IGraphRequestPayload,
} from "@flutchai/flutch-sdk";
import {
  StateGraph,
  START,
  END,
  Annotation,
  MessagesAnnotation,
} from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage, BaseMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * State for MCP tool agent
 */
const AgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
});

type AgentStateType = typeof AgentState.State;

/**
 * Mock MCP tool that simulates fetching from MCP Runtime
 * In production, this would call your MCP Runtime service
 */
function createMockMcpTool(
  name: string,
  description: string
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name,
    description,
    schema: z.object({
      query: z.string().describe("The query or input for the tool"),
    }),
    func: async ({ query }) => {
      // Simulate MCP tool execution
      return JSON.stringify({
        tool: name,
        query,
        result: `Mock result from ${name} for query: "${query}"`,
        timestamp: new Date().toISOString(),
      });
    },
  });
}

/**
 * MCP-enabled agent builder
 * Demonstrates how to integrate MCP tools with the SDK
 */
@Injectable()
export class McpAgentBuilder extends ExternalGraphBuilder<"1.0.0"> {
  readonly version = "1.0.0" as const;

  private tools: DynamicStructuredTool[];

  constructor() {
    super();

    // Create mock MCP tools for demonstration
    // In production, these would be fetched from MCP Runtime
    this.tools = [
      createMockMcpTool(
        "search_documents",
        "Search through documents in the knowledge base"
      ),
      createMockMcpTool(
        "get_user_info",
        "Get information about a user by their ID or email"
      ),
      createMockMcpTool(
        "create_ticket",
        "Create a support ticket in the ticketing system"
      ),
      createMockMcpTool(
        "send_notification",
        "Send a notification to a user or channel"
      ),
    ];
  }

  /**
   * In production, you would fetch tools from MCP Runtime like this:
   *
   * async loadMcpTools(toolsConfig: IAgentToolConfig[]): Promise<DynamicStructuredTool[]> {
   *   const mcpToolFilter = new McpToolFilter();
   *   return await mcpToolFilter.getFilteredTools(toolsConfig);
   * }
   */

  async buildGraph(payload: IGraphRequestPayload): Promise<any> {
    // Initialize model with tools bound
    const model = new ChatOpenAI({
      modelName: "gpt-4o-mini",
      temperature: 0,
      streaming: true,
    }).bindTools(this.tools);

    const toolNode = new ToolNode(this.tools);

    // Determine whether to continue or end
    const shouldContinue = (state: AgentStateType) => {
      const lastMessage = state.messages[state.messages.length - 1];

      if (
        lastMessage &&
        "tool_calls" in lastMessage &&
        (lastMessage.tool_calls as unknown[])?.length
      ) {
        return "tools";
      }
      return END;
    };

    const graph = new StateGraph(AgentState)
      .addNode("agent", async (state: AgentStateType) => {
        const response = await model.invoke(state.messages);
        return { messages: [response] };
      })
      .addNode("tools", toolNode)
      .addEdge(START, "agent")
      .addEdge("tools", "agent")
      .addConditionalEdges("agent", shouldContinue);

    return graph.compile();
  }

  async prepareConfig(payload: IGraphRequestPayload): Promise<any> {
    const baseConfig = await super.prepareConfig(payload);

    const messageContent = payload.message?.content || "";
    const humanMessage = new HumanMessage(
      typeof messageContent === "string"
        ? messageContent
        : JSON.stringify(messageContent)
    );

    // History support
    const history: BaseMessage[] = [];
    if (payload.context?.history) {
      for (const msg of payload.context.history as Array<{
        role: string;
        content: string;
      }>) {
        if (msg.role === "user") {
          history.push(new HumanMessage(msg.content));
        } else if (msg.role === "assistant") {
          history.push(new AIMessage(msg.content));
        }
      }
    }

    return {
      ...baseConfig,
      input: {
        messages: [...history, humanMessage],
      },
    };
  }

  /**
   * Get list of available tools
   */
  getAvailableTools(): string[] {
    return this.tools.map(t => t.name);
  }
}

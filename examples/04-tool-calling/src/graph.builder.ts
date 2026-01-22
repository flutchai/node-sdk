import { Injectable } from "@nestjs/common";
import {
  AbstractGraphBuilder,
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
import { tools } from "./tools";

/**
 * Define the state schema for our tool-calling agent
 */
const AgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
});

type AgentStateType = typeof AgentState.State;

/**
 * Tool-calling agent builder
 */
@Injectable()
export class ToolCallingAgentBuilder extends AbstractGraphBuilder<"1.0.0"> {
  readonly version = "1.0.0" as const;

  async buildGraph(payload: IGraphRequestPayload): Promise<any> {
    // Initialize model with tools bound
    const model = new ChatOpenAI({
      modelName: "gpt-4o-mini",
      temperature: 0,
      streaming: true,
    }).bindTools(tools);

    // Create tool node for executing tools
    const toolNode = new ToolNode(tools);

    // Function to determine next step
    const shouldContinue = (state: AgentStateType) => {
      const lastMessage = state.messages[state.messages.length - 1];

      // If the last message has tool calls, route to tools
      if (
        lastMessage &&
        "tool_calls" in lastMessage &&
        (lastMessage.tool_calls as unknown[])?.length
      ) {
        return "tools";
      }

      // Otherwise, end
      return END;
    };

    const graph = new StateGraph(AgentState)
      // Agent node - calls the LLM
      .addNode("agent", async (state: AgentStateType) => {
        const response = await model.invoke(state.messages);
        return { messages: [response] };
      })
      // Tool node - executes tool calls
      .addNode("tools", toolNode)
      // Start with agent
      .addEdge(START, "agent")
      // After tools, go back to agent
      .addEdge("tools", "agent")
      // Conditional routing from agent
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

    // Add history if provided
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
}

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

/**
 * Define the state schema for our chat graph
 * Using MessagesAnnotation for automatic message history management
 */
const ChatState = Annotation.Root({
  ...MessagesAnnotation.spec,
  // Add any additional state fields here
});

type ChatStateType = typeof ChatState.State;

/**
 * Chat agent builder that uses OpenAI for conversation
 */
@Injectable()
export class ChatAgentBuilder extends AbstractGraphBuilder<"1.0.0"> {
  readonly version = "1.0.0" as const;

  private model: ChatOpenAI;

  constructor() {
    super();
    // Initialize OpenAI model
    this.model = new ChatOpenAI({
      modelName: "gpt-4o-mini",
      temperature: 0.7,
      streaming: true,
    });
  }

  async buildGraph(payload: IGraphRequestPayload): Promise<any> {
    const model = this.model;

    // Create a chat graph
    const graph = new StateGraph(ChatState)
      // Add the chat node that calls the LLM
      .addNode("chat", async (state: ChatStateType) => {
        // Call the model with the message history
        const response = await model.invoke(state.messages);

        // Return the new message to be added to history
        return { messages: [response] };
      })
      // Connect the nodes
      .addEdge(START, "chat")
      .addEdge("chat", END);

    // Compile the graph
    const compiled = graph.compile();

    return compiled;
  }

  /**
   * Prepare the configuration for graph execution
   */
  async prepareConfig(payload: IGraphRequestPayload): Promise<any> {
    const baseConfig = await super.prepareConfig(payload);

    // Convert the incoming message to LangChain format
    const messageContent = payload.message?.content || "";
    const humanMessage = new HumanMessage(
      typeof messageContent === "string"
        ? messageContent
        : JSON.stringify(messageContent)
    );

    // You can also add conversation history from context
    const history: BaseMessage[] = [];
    if (payload.context?.history) {
      for (const msg of payload.context.history) {
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

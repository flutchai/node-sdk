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
import {
  HumanMessage,
  SystemMessage,
  BaseMessage,
} from "@langchain/core/messages";

/**
 * State for the streaming chat
 */
const ChatState = Annotation.Root({
  ...MessagesAnnotation.spec,
});

type ChatStateType = typeof ChatState.State;

/**
 * Streaming chat builder
 * Demonstrates real-time streaming of LLM responses
 */
@Injectable()
export class StreamingChatBuilder extends AbstractGraphBuilder<"1.0.0"> {
  readonly version = "1.0.0" as const;

  private model: ChatOpenAI;

  constructor() {
    super();
    this.model = new ChatOpenAI({
      modelName: "gpt-4o-mini",
      temperature: 0.7,
      streaming: true, // Enable streaming
    });
  }

  async buildGraph(payload: IGraphRequestPayload): Promise<any> {
    const model = this.model;

    const graph = new StateGraph(ChatState)
      .addNode("chat", async (state: ChatStateType) => {
        // Add a system message for better responses
        const messagesWithSystem = [
          new SystemMessage(
            "You are a creative storyteller. When asked to tell a story, " +
              "create an engaging narrative with vivid descriptions. " +
              "Take your time to build the story with proper pacing."
          ),
          ...state.messages,
        ];

        const response = await model.invoke(messagesWithSystem);
        return { messages: [response] };
      })
      .addEdge(START, "chat")
      .addEdge("chat", END);

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

    // Include history if provided
    const history: BaseMessage[] = [];
    if (payload.context?.history) {
      for (const msg of payload.context.history) {
        if (msg.role === "user") {
          history.push(new HumanMessage(msg.content));
        } else if (msg.role === "assistant") {
          history.push(new HumanMessage(msg.content)); // Simplified for example
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

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
import {
  HumanMessage,
  SystemMessage,
  BaseMessage,
} from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ModelFactory, LLMProvider } from "./model-factory";

/**
 * State for the multi-LLM chat
 */
const ChatState = Annotation.Root({
  ...MessagesAnnotation.spec,
  provider: Annotation<LLMProvider>(),
});

type ChatStateType = typeof ChatState.State;

/**
 * Multi-LLM chat builder
 * Supports switching between OpenAI, Anthropic, and Mistral
 */
@Injectable()
export class MultiLLMBuilder extends ExternalGraphBuilder<"1.0.0"> {
  readonly version = "1.0.0" as const;

  // Cache for model instances
  private models: Map<LLMProvider, BaseChatModel> = new Map();

  constructor() {
    super();
    // Pre-initialize available models
    this.initializeModels();
  }

  private initializeModels() {
    const availableProviders = ModelFactory.getAvailableProviders();

    for (const provider of availableProviders) {
      try {
        const model = ModelFactory.createModel({ provider });
        this.models.set(provider, model);
        console.log(`Initialized ${provider} model`);
      } catch (error) {
        console.warn(`Failed to initialize ${provider} model:`, error);
      }
    }

    if (this.models.size === 0) {
      throw new Error(
        "No LLM providers configured. Please set at least one API key in .env"
      );
    }
  }

  private getModel(provider: LLMProvider): BaseChatModel {
    const model = this.models.get(provider);
    if (!model) {
      // Fall back to first available model
      const firstEntry = this.models.entries().next();
      if (firstEntry.done || !firstEntry.value) {
        throw new Error("No models available");
      }
      const [firstProvider, firstModel] = firstEntry.value;
      console.warn(
        `Provider ${provider} not available, falling back to ${firstProvider}`
      );
      return firstModel;
    }
    return model;
  }

  async buildGraph(payload: IGraphRequestPayload): Promise<any> {
    const builder = this;

    const graph = new StateGraph(ChatState)
      .addNode("chat", async (state: ChatStateType) => {
        // Get the model for the requested provider
        const model = builder.getModel(state.provider || "openai");

        // Add system message
        const messagesWithSystem = [
          new SystemMessage(
            `You are a helpful assistant powered by ${state.provider || "AI"}. ` +
              "Respond concisely and helpfully."
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

    // Get provider from context or default to openai
    const provider: LLMProvider =
      (payload.context?.provider as LLMProvider) || "openai";

    // Include history if provided
    const history: BaseMessage[] = [];
    if (payload.context?.history) {
      for (const msg of payload.context.history as Array<{
        role: string;
        content: string;
      }>) {
        if (msg.role === "user") {
          history.push(new HumanMessage(msg.content));
        }
      }
    }

    return {
      ...baseConfig,
      input: {
        messages: [...history, humanMessage],
        provider,
      },
    };
  }

  /**
   * Get list of available providers
   */
  getAvailableProviders(): LLMProvider[] {
    return Array.from(this.models.keys());
  }
}

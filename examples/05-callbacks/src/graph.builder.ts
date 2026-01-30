import { Injectable } from "@nestjs/common";
import {
  ExternalGraphBuilder,
  IGraphRequestPayload,
  WithCallbacks,
} from "@flutchai/flutch-sdk";
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { OrderCallbacks } from "./callbacks.js";

/**
 * State for order processing
 */
const OrderState = Annotation.Root({
  query: Annotation<string>(),
  orderId: Annotation<string>(),
  orderDetails: Annotation<any>(),
  response: Annotation<string>(),
  callbackButtons: Annotation<any[]>(),
});

type OrderStateType = typeof OrderState.State;

/**
 * Order processing builder with callbacks
 * The @WithCallbacks decorator mixes in the callback handlers
 */
@Injectable()
@WithCallbacks(OrderCallbacks)
export class OrderProcessingBuilder extends ExternalGraphBuilder<"1.0.0"> {
  readonly version = "1.0.0" as const;

  private model: ChatOpenAI;

  constructor() {
    super();
    this.model = new ChatOpenAI({
      modelName: "gpt-4o-mini",
      temperature: 0.3,
      streaming: true,
    });
  }

  async buildGraph(payload: IGraphRequestPayload): Promise<any> {
    const model = this.model;
    const graphType = this.graphType;

    const graph = new StateGraph(OrderState)
      // Parse order from user query
      .addNode("parse_order", async (state: OrderStateType) => {
        // Generate a mock order ID
        const orderId = `ORD-${Date.now()}`;

        // Mock order details (in real app, fetch from database)
        const orderDetails = {
          id: orderId,
          items: [
            { name: "Widget A", quantity: 2, price: 29.99 },
            { name: "Widget B", quantity: 1, price: 49.99 },
          ],
          total: 109.97,
          customer: "John Doe",
          shippingAddress: "123 Main St, City, Country",
        };

        return { orderId, orderDetails };
      })
      // Generate response with callback buttons
      .addNode("generate_response", async (state: OrderStateType) => {
        const { orderId, orderDetails } = state;

        // Generate a summary using LLM
        const prompt = `Summarize this order briefly:
Order ID: ${orderId}
Items: ${JSON.stringify(orderDetails.items)}
Total: $${orderDetails.total}
Customer: ${orderDetails.customer}`;

        const llmResponse = await model.invoke([new HumanMessage(prompt)]);
        const summary =
          typeof llmResponse.content === "string"
            ? llmResponse.content
            : JSON.stringify(llmResponse.content);

        // Create callback buttons
        // These will be encoded into tokens that can be clicked/invoked
        const callbackButtons = [
          {
            label: "Approve Order",
            handler: "approve-order",
            params: { orderId },
            style: "primary",
          },
          {
            label: "Reject Order",
            handler: "reject-order",
            params: { orderId, reason: "User rejected" },
            style: "danger",
          },
          {
            label: "Request More Info",
            handler: "request-info",
            params: { orderId, infoType: "shipping" },
            style: "secondary",
          },
        ];

        const response = `${summary}\n\nPlease choose an action for this order:`;

        return { response, callbackButtons };
      })
      .addEdge(START, "parse_order")
      .addEdge("parse_order", "generate_response")
      .addEdge("generate_response", END);

    return graph.compile();
  }

  async prepareConfig(payload: IGraphRequestPayload): Promise<any> {
    const baseConfig = await super.prepareConfig(payload);

    const messageContent = payload.message?.content || "";
    const query =
      typeof messageContent === "string"
        ? messageContent
        : JSON.stringify(messageContent);

    return {
      ...baseConfig,
      input: {
        query,
        orderId: "",
        orderDetails: null,
        response: "",
        callbackButtons: [],
      },
    };
  }
}

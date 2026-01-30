import { Injectable } from "@nestjs/common";
import {
  ExternalGraphBuilder,
  IGraphRequestPayload,
} from "@flutchai/flutch-sdk";
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { Document } from "@langchain/core/documents";
import { HumanMessage } from "@langchain/core/messages";

/**
 * Simple in-memory document store for demonstration
 * In production, you would use a vector database like Pinecone, Weaviate, etc.
 */
class SimpleDocumentStore {
  private documents: Document[] = [];
  private embeddings: OpenAIEmbeddings;

  constructor() {
    this.embeddings = new OpenAIEmbeddings({
      modelName: "text-embedding-3-small",
    });

    // Add some sample documents
    this.documents = [
      new Document({
        pageContent:
          "Flutch SDK is a framework for building AI agent microservices with NestJS and LangGraph.",
        metadata: { source: "docs", topic: "overview" },
      }),
      new Document({
        pageContent:
          "The ExternalGraphBuilder is the base class for all graph implementations. It provides version management and callback registration.",
        metadata: { source: "docs", topic: "builders" },
      }),
      new Document({
        pageContent:
          "UniversalGraphModule.forRoot() sets up REST API endpoints, health checks, callback system, and Prometheus metrics.",
        metadata: { source: "docs", topic: "module" },
      }),
      new Document({
        pageContent:
          "Callbacks allow interactive flows where users can make choices that affect the graph execution.",
        metadata: { source: "docs", topic: "callbacks" },
      }),
      new Document({
        pageContent:
          "The SDK supports multiple LLM providers: OpenAI, Anthropic, Mistral, Cohere, and Azure OpenAI.",
        metadata: { source: "docs", topic: "models" },
      }),
    ];
  }

  /**
   * Simple keyword-based retrieval
   * In production, use vector similarity search
   */
  async retrieve(query: string, k: number = 3): Promise<Document[]> {
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/);

    // Score documents by keyword overlap
    const scored = this.documents.map(doc => {
      const content = doc.pageContent.toLowerCase();
      let score = 0;
      for (const word of queryWords) {
        if (content.includes(word)) {
          score += 1;
        }
      }
      return { doc, score };
    });

    // Sort by score and return top k
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(s => s.doc);
  }
}

/**
 * Define the state schema for our RAG graph
 */
const RagState = Annotation.Root({
  query: Annotation<string>(),
  documents: Annotation<Document[]>(),
  answer: Annotation<string>(),
});

type RagStateType = typeof RagState.State;

/**
 * RAG agent builder with retrieval and generation
 */
@Injectable()
export class RagAgentBuilder extends ExternalGraphBuilder<"1.0.0"> {
  readonly version = "1.0.0" as const;

  private model: ChatOpenAI;
  private documentStore: SimpleDocumentStore;

  constructor() {
    super();
    this.model = new ChatOpenAI({
      modelName: "gpt-4o-mini",
      temperature: 0.3, // Lower temperature for more factual responses
      streaming: true,
    });
    this.documentStore = new SimpleDocumentStore();
  }

  async buildGraph(payload: IGraphRequestPayload): Promise<any> {
    const model = this.model;
    const documentStore = this.documentStore;

    const graph = new StateGraph(RagState)
      // Retrieve relevant documents
      .addNode("retrieve", async (state: RagStateType) => {
        const documents = await documentStore.retrieve(state.query, 3);
        return { documents };
      })
      // Generate answer using retrieved context
      .addNode("generate", async (state: RagStateType) => {
        // Format documents as context
        const context = state.documents
          .map((doc, i) => `[${i + 1}] ${doc.pageContent}`)
          .join("\n\n");

        // Create the prompt with context
        const prompt = `Answer the question based on the following context. If the answer cannot be found in the context, say so.

Context:
${context}

Question: ${state.query}

Answer:`;

        const response = await model.invoke([new HumanMessage(prompt)]);
        const answer =
          typeof response.content === "string"
            ? response.content
            : JSON.stringify(response.content);

        return { answer };
      })
      // Connect nodes
      .addEdge(START, "retrieve")
      .addEdge("retrieve", "generate")
      .addEdge("generate", END);

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
      input: { query, documents: [], answer: "" },
    };
  }
}

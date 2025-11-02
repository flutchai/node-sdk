import { BaseDocumentCompressor } from "@langchain/core/retrievers/document_compressors";
import { Document } from "@langchain/core/documents";

export interface VoyageAIRerankConfig {
  apiKey?: string;
  model?: string;
  topN?: number;
  truncation?: boolean;
}

/**
 * VoyageAI Reranker implementation
 * Note: This is a placeholder implementation until official LangChain.js support is available
 * VoyageAI currently only has Python SDK support for reranking
 */
export class VoyageAIRerank extends BaseDocumentCompressor {
  private apiKey: string;
  private model: string;
  private topN: number;
  private truncation: boolean;
  private baseUrl = "https://api.voyageai.com/v1/rerank";

  constructor(config: VoyageAIRerankConfig) {
    super();
    this.apiKey = config.apiKey || process.env.VOYAGEAI_API_KEY || "";
    this.model = config.model || "rerank-2";
    this.topN = config.topN || 20;
    this.truncation = config.truncation ?? true;

    if (!this.apiKey) {
      throw new Error(
        "VoyageAI API key is required. Set VOYAGEAI_API_KEY environment variable or pass apiKey in config."
      );
    }
  }

  async compressDocuments(
    documents: Document[],
    query: string,
    callbacks?: any
  ): Promise<Document[]> {
    if (documents.length === 0) {
      return [];
    }

    const texts = documents.map(doc => doc.pageContent);

    try {
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          query: query,
          documents: texts,
          top_k: Math.min(this.topN, documents.length),
          truncation: this.truncation,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`VoyageAI API error: ${response.status} - ${error}`);
      }

      const data = await response.json();

      // VoyageAI returns results with relevance scores
      // Sort by relevance and return top N documents
      const rerankedIndices = data.results
        .sort((a: any, b: any) => b.relevance_score - a.relevance_score)
        .slice(0, this.topN)
        .map((result: any) => result.index);

      return rerankedIndices.map((index: number) => documents[index]);
    } catch (error) {
      console.error("Error calling VoyageAI rerank API:", error);
      // Fallback: return original documents if reranking fails
      return documents.slice(0, this.topN);
    }
  }
}

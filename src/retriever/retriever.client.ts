import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { RetrieverSearchType } from "./enums";
import { CustomDocument } from "./types";

export interface RetrieverClientConfig {
  baseUrl: string;
  timeout?: number;
  retries?: number;
}

/**
 * HTTP client for interacting with retriever service
 * Allows graphs to get data from knowledge base without direct dependencies
 */
@Injectable()
export class RetrieverClient {
  private readonly logger = new Logger(RetrieverClient.name);
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly retries: number;

  constructor(
    private readonly httpService: HttpService,
    config: RetrieverClientConfig
  ) {
    this.baseUrl = config.baseUrl;
    this.timeout = config.timeout || 180000; // 3 minutes default for graph operations
    this.retries = config.retries || 3;
  }

  /**
   * Search documents in knowledge base
   */
  async search(
    query: string,
    searchType: RetrieverSearchType,
    knowledgeBaseIds: string[],
    options?: {
      k?: number;
      threshold?: number;
      metadata?: Record<string, any>;
    }
  ): Promise<CustomDocument[]> {
    const url = `${this.baseUrl}/api/internal/retriever/search`;

    const payload = {
      query,
      searchType,
      knowledgeBaseIds,
      options: {
        k: options?.k || 10,
        threshold: options?.threshold || 0.7,
        metadata: options?.metadata || {},
      },
    };

    this.logger.debug(`Searching documents: ${query}`, {
      searchType,
      knowledgeBaseIds,
      options: payload.options,
    });

    try {
      const response = await firstValueFrom(
        this.httpService.post<{ documents: CustomDocument[] }>(url, payload, {
          timeout: this.timeout,
        })
      );

      const documents = response.data.documents || [];

      this.logger.debug(`Found ${documents.length} documents`);

      return documents;
    } catch (error) {
      this.logger.error(
        `Failed to search documents: ${error instanceof Error ? error.message : String(error)}`,
        {
          query,
          searchType,
          knowledgeBaseIds,
          error:
            error instanceof Error && "response" in error
              ? (error as any).response?.data || error.message
              : String(error),
        }
      );

      // In case of error, return empty array
      // Graph can continue working without documents
      return [];
    }
  }

  /**
   * Check retriever service availability
   */
  async healthCheck(): Promise<boolean> {
    const url = `${this.baseUrl}/api/internal/retriever/health`;

    try {
      const response = await firstValueFrom(
        this.httpService.get(url, {
          timeout: 5000,
        })
      );

      return response.status === 200;
    } catch (error) {
      this.logger.warn(
        `Retriever service is not available: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /**
   * Get knowledge base metadata
   */
  async getKnowledgeBaseInfo(knowledgeBaseId: string): Promise<{
    id: string;
    name: string;
    documentsCount: number;
    lastUpdated: string;
  } | null> {
    const url = `${this.baseUrl}/api/internal/retriever/kb/${knowledgeBaseId}`;

    try {
      const response = await firstValueFrom(
        this.httpService.get(url, {
          timeout: this.timeout,
        })
      );

      return response.data;
    } catch (error) {
      this.logger.error(
        `Failed to get KB info: ${error instanceof Error ? error.message : String(error)}`,
        {
          knowledgeBaseId,
        }
      );

      return null;
    }
  }
}

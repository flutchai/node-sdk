import { Injectable, Logger } from "@nestjs/common";
import { RetrieverSearchType } from "../shared-types";
import {
  CustomDocument,
  RetrieveQueryOptions,
  KnowledgeBaseInfo,
} from "./types";

export interface RetrieverConfig {
  /**
   * Base URL for the main backend service (k8s endpoint)
   * If not specified, will use environment variable
   */
  apiUrl?: string;
  /**
   * Internal API token for backend communication
   * If not specified, will use environment variable
   */
  internalToken?: string;
  /**
   * Request timeout in milliseconds
   */
  timeout?: number;
  /**
   * Number of retries for failed requests
   */
  retries?: number;
}

/**
 * Retriever Service
 * HTTP-based service for knowledge base retrieval through main backend
 * Follows the same pattern as LLM initializer for k8s communication
 */
@Injectable()
export class RetrieverService {
  private readonly logger = new Logger(RetrieverService.name);
  private readonly apiUrl: string;
  private readonly internalToken: string;
  private readonly timeout: number;
  private readonly retries: number;

  constructor(config: RetrieverConfig = {}) {
    // this.logger = config.logger || new ConsoleLogger();

    // Priority: config values > environment variables > defaults
    this.apiUrl =
      config.apiUrl || process.env.API_URL || "http://amelie-service";
    this.internalToken =
      config.internalToken || process.env.INTERNAL_API_TOKEN || "";
    this.timeout = config.timeout || 30000; // 30 seconds default
    this.retries = config.retries || 3;

    if (!this.internalToken) {
      throw new Error("INTERNAL_API_TOKEN required for backend communication");
    }

    this.logger.log(
      `RetrieverService initialized with API URL: ${this.apiUrl}`
    );
  }

  /**
   * Make HTTP request to backend with retry logic
   */
  private async makeRequest<T>(
    endpoint: string,
    options: {
      method?: "GET" | "POST";
      body?: any;
      timeout?: number;
    } = {}
  ): Promise<T> {
    const { method = "GET", body, timeout = this.timeout } = options;
    const url = `${this.apiUrl}${endpoint}`;

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.retries; attempt++) {
      try {
        this.logger.debug?.(
          `Making ${method} request to ${url} (attempt ${attempt}/${this.retries})`
        );

        const response = await fetch(url, {
          method,
          headers: {
            "x-internal-token": this.internalToken,
            "Content-Type": "application/json",
            "User-Agent": "RetrieverService/1.0.0",
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(timeout),
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "Unknown error");
          throw new Error(
            `HTTP ${response.status} ${response.statusText}: ${errorText}`
          );
        }

        const data = await response.json();
        this.logger.debug?.(`Request successful on attempt ${attempt}`);
        return data;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt === this.retries) {
          this.logger.error(
            `Request failed after ${this.retries} attempts: ${lastError.message}`
          );
          break;
        }

        const backoffDelay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        this.logger.warn(
          `Request failed (attempt ${attempt}/${this.retries}), retrying in ${backoffDelay}ms: ${lastError.message}`
        );

        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      }
    }

    if (!lastError) {
      throw new Error("Request failed with unknown error");
    }

    throw lastError;
  }

  /**
   * Health check for the service
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.makeRequest("/health", { timeout: 5000 });
      return true;
    } catch (error) {
      this.logger.warn(`Health check failed: ${error}`);
      return false;
    }
  }

  /**
   * Search documents in knowledge base through backend API
   */
  async search(
    query: string,
    searchType: RetrieverSearchType,
    knowledgeBaseIds: string[],
    options?: RetrieveQueryOptions
  ): Promise<CustomDocument[]> {
    if (!query?.trim()) {
      this.logger.warn("Empty query provided to search");
      return [];
    }

    if (!knowledgeBaseIds?.length) {
      this.logger.warn("No knowledge base IDs provided");
      return [];
    }

    const searchOptions = {
      k: options?.k || 10,
      threshold: options?.threshold || 0.7,
      metadata: options?.metadata || {},
    };

    this.logger.debug?.(`Searching documents: "${query}"`, {
      searchType,
      knowledgeBaseIds: knowledgeBaseIds.length,
      options: searchOptions,
    });

    try {
      const response = await this.makeRequest<{
        documents: CustomDocument[];
        totalFound: number;
        searchType: string;
      }>("/internal/knowledge-base/search", {
        method: "POST",
        body: {
          query: query.trim(),
          searchType,
          knowledgeBaseIds,
          options: searchOptions,
        },
      });

      const documents = response.documents || [];

      this.logger.debug?.(
        `Found ${documents.length} documents from ${response.totalFound || 0} total matches`
      );

      // Validate document structure
      return documents.filter(doc => {
        if (!doc.id || !doc.content) {
          this.logger.warn("Invalid document structure detected, skipping");
          return false;
        }
        return true;
      });
    } catch (error) {
      this.logger.error(`Failed to search documents: ${error}`, {
        query,
        searchType,
        knowledgeBaseIds,
        options: searchOptions,
      });

      // Return empty array on error to allow graph to continue
      return [];
    }
  }

  /**
   * Get documents by their IDs
   */
  async getDocumentsByIds(ids: string[]): Promise<CustomDocument[]> {
    if (!ids?.length) {
      this.logger.warn("No document IDs provided");
      return [];
    }

    // Validate IDs format
    const validIds = ids
      .filter(id => {
        if (!id || typeof id !== "string" || id.trim() === "") {
          this.logger.warn(`Invalid document ID: ${id}`);
          return false;
        }
        return true;
      })
      .map(id => id.trim());

    if (!validIds.length) {
      this.logger.warn("No valid document IDs provided");
      return [];
    }

    this.logger.debug?.(`Fetching ${validIds.length} documents by IDs`);

    try {
      const response = await this.makeRequest<{
        documents: CustomDocument[];
      }>("/internal/knowledge-base/documents/batch", {
        method: "POST",
        body: { ids: validIds },
      });

      const documents = response.documents || [];

      this.logger.debug?.(
        `Retrieved ${documents.length}/${validIds.length} documents`
      );

      return documents;
    } catch (error) {
      this.logger.error(`Failed to get documents by IDs: ${error}`, {
        requestedIds: validIds.length,
      });

      return [];
    }
  }

  /**
   * Check if knowledge base exists and is accessible
   */
  async knowledgeBaseExists(knowledgeBaseId: string): Promise<boolean> {
    if (!knowledgeBaseId?.trim()) {
      this.logger.warn("Empty knowledge base ID provided");
      return false;
    }

    try {
      const response = await this.makeRequest<{
        exists: boolean;
        accessible: boolean;
      }>(`/internal/knowledge-base/${knowledgeBaseId.trim()}/status`);

      const exists = response.exists && response.accessible;

      this.logger.debug?.(
        `Knowledge base ${knowledgeBaseId} ${exists ? "exists and is accessible" : "does not exist or is not accessible"}`
      );

      return exists;
    } catch (error) {
      this.logger.error(`Failed to check KB existence: ${error}`, {
        knowledgeBaseId,
      });

      return false;
    }
  }

  /**
   * Get knowledge base information
   */
  async getKnowledgeBaseInfo(
    knowledgeBaseId: string
  ): Promise<KnowledgeBaseInfo | null> {
    if (!knowledgeBaseId?.trim()) {
      this.logger.warn("Empty knowledge base ID provided");
      return null;
    }

    try {
      const response = await this.makeRequest<KnowledgeBaseInfo>(
        `/internal/knowledge-base/${knowledgeBaseId.trim()}/info`
      );

      this.logger.debug?.(`Retrieved KB info for ${knowledgeBaseId}`, {
        name: response.name,
        documentsCount: response.documentsCount,
      });

      return response;
    } catch (error) {
      this.logger.error(`Failed to get KB info: ${error}`, {
        knowledgeBaseId,
      });

      return null;
    }
  }

  /**
   * Simple text search (fallback for when vector search is not available)
   */
  async textSearch(
    query: string,
    knowledgeBaseIds: string[],
    limit: number = 10
  ): Promise<CustomDocument[]> {
    if (!query?.trim()) {
      this.logger.warn("Empty query provided to text search");
      return [];
    }

    if (!knowledgeBaseIds?.length) {
      this.logger.warn("No knowledge base IDs provided to text search");
      return [];
    }

    this.logger.debug?.(`Performing text search: "${query}"`, {
      knowledgeBaseIds: knowledgeBaseIds.length,
      limit,
    });

    try {
      const response = await this.makeRequest<{
        documents: CustomDocument[];
      }>("/internal/knowledge-base/text-search", {
        method: "POST",
        body: {
          query: query.trim(),
          knowledgeBaseIds,
          limit: Math.max(1, Math.min(limit, 100)), // Ensure reasonable limits
        },
      });

      const documents = response.documents || [];

      this.logger.debug?.(`Text search found ${documents.length} documents`);

      return documents;
    } catch (error) {
      this.logger.error(`Failed to perform text search: ${error}`, {
        query,
        knowledgeBaseIds,
        limit,
      });

      return [];
    }
  }

  /**
   * Get available knowledge bases for the current context
   */
  async getAvailableKnowledgeBases(): Promise<KnowledgeBaseInfo[]> {
    try {
      const response = await this.makeRequest<{
        knowledgeBases: KnowledgeBaseInfo[];
      }>("/internal/knowledge-base/available");

      const kbs = response.knowledgeBases || [];

      this.logger.debug?.(`Found ${kbs.length} available knowledge bases`);

      return kbs;
    } catch (error) {
      this.logger.error(`Failed to get available knowledge bases: ${error}`);

      return [];
    }
  }

  /**
   * Check service health and configuration
   */
  check(): string {
    return `RetrieverService configured with API URL: ${this.apiUrl}, timeout: ${this.timeout}ms, retries: ${this.retries}`;
  }
}

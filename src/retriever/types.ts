/**
 * Common types for retriever
 */

export interface CustomDocument {
  id: string;
  content: string;
  metadata: {
    knowledgeBaseId: string;
    source?: string;
    title?: string;
    url?: string;
    [key: string]: any;
  };
}

export interface RetrieveQueryOptions {
  k?: number;
  threshold?: number;
  metadata?: Record<string, any>;
}

export interface KnowledgeBaseInfo {
  id: string;
  name: string;
  documentsCount: number;
  lastUpdated: string;
}

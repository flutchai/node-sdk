import { Injectable, Logger } from "@nestjs/common";
import { JSONSchema7 } from "json-schema";

/**
 * Request context for endpoint calls
 */
export interface RequestContext {
  userId: string;
  companyId?: string;
  method: "GET" | "POST";
  payload?: any;
  channel: string; // 'web', 'webapp'
  platform?: string; // 'telegram', 'slack', 'discord'
}

/**
 * Universal response envelope
 */
export interface DataEnvelope<T = any> {
  schema: string; // Schema name or data type
  data: T; // The actual data
  meta?: {
    total?: number; // For pagination
    page?: number;
    redirect?: string; // For navigation after action
    message?: string; // Message to user
  };
}

/**
 * Endpoint handler function type
 */
export type EndpointHandler = (ctx: RequestContext) => Promise<DataEnvelope>;

/**
 * Endpoint descriptor interface
 */
export interface EndpointDescriptor {
  name: string; // "accounts.list"
  method: "GET" | "POST";
  handler: EndpointHandler;
  schema?: JSONSchema7;
}

/**
 * Registry for graph UI endpoints
 * Similar to CallbackRegistry but for synchronous data operations without TTL
 */
@Injectable()
export class EndpointRegistry {
  private readonly logger = new Logger(EndpointRegistry.name);

  // Map<graphType, Map<endpointName, EndpointDescriptor>>
  private readonly endpoints = new Map<
    string,
    Map<string, EndpointDescriptor>
  >();

  /**
   * Register an endpoint for a specific graph type
   * @param graphType The graph type (e.g., "ledger::1.0.0")
   * @param endpoint The endpoint descriptor
   */
  register(graphType: string, endpoint: EndpointDescriptor): void {
    if (!this.endpoints.has(graphType)) {
      this.endpoints.set(graphType, new Map());
    }

    const graphEndpoints = this.endpoints.get(graphType)!;
    graphEndpoints.set(endpoint.name, endpoint);

    this.logger.debug(
      `Registered endpoint "${endpoint.name}" for graph type "${graphType}"`
    );
  }

  /**
   * Register multiple endpoints for a graph type
   * @param graphType The graph type
   * @param endpoints Array of endpoint descriptors
   */
  registerMultiple(graphType: string, endpoints: EndpointDescriptor[]): void {
    for (const endpoint of endpoints) {
      this.register(graphType, endpoint);
    }
  }

  /**
   * Get an endpoint handler
   * @param graphType The graph type
   * @param endpointName The endpoint name
   * @returns The endpoint descriptor or undefined
   */
  get(graphType: string, endpointName: string): EndpointDescriptor | undefined {
    const graphEndpoints = this.endpoints.get(graphType);
    return graphEndpoints?.get(endpointName);
  }

  /**
   * List all endpoints for a graph type
   * @param graphType The graph type
   * @returns Array of endpoint names
   */
  list(graphType: string): string[] {
    const graphEndpoints = this.endpoints.get(graphType);
    if (!graphEndpoints) {
      return [];
    }
    return Array.from(graphEndpoints.keys());
  }

  /**
   * Alias for list() method for compatibility
   */
  listEndpoints(graphType: string): string[] {
    return this.list(graphType);
  }

  /**
   * List all registered graph types
   * @returns Array of graph type names
   */
  listGraphTypes(): string[] {
    return Array.from(this.endpoints.keys());
  }

  /**
   * Call an endpoint
   * @param graphType The graph type
   * @param endpointName The endpoint name
   * @param context The request context
   * @returns The response envelope
   */
  async call(
    graphType: string,
    endpointName: string,
    context: RequestContext
  ): Promise<DataEnvelope> {
    const endpoint = this.get(graphType, endpointName);

    if (!endpoint) {
      throw new Error(
        `Endpoint "${endpointName}" not found for graph "${graphType}"`
      );
    }

    // Validate HTTP method matches
    if (endpoint.method !== context.method) {
      throw new Error(
        `Method mismatch: endpoint expects ${endpoint.method}, got ${context.method}`
      );
    }

    this.logger.debug(
      `Calling endpoint "${endpointName}" for graph "${graphType}" with method ${context.method}`
    );

    try {
      return await endpoint.handler(context);
    } catch (error) {
      this.logger.error(
        `Error calling endpoint "${endpointName}" for graph "${graphType}":`,
        error
      );
      throw error;
    }
  }

  /**
   * Get statistics about registered endpoints
   */
  getStats(): {
    totalGraphTypes: number;
    totalEndpoints: number;
    endpointsByGraph: Record<string, number>;
  } {
    const stats = {
      totalGraphTypes: this.endpoints.size,
      totalEndpoints: 0,
      endpointsByGraph: {} as Record<string, number>,
    };

    for (const [graphType, endpoints] of this.endpoints) {
      const count = endpoints.size;
      stats.totalEndpoints += count;
      stats.endpointsByGraph[graphType] = count;
    }

    return stats;
  }

  /**
   * Clear all endpoints (mainly for testing)
   */
  clear(): void {
    this.endpoints.clear();
    this.logger.debug("Cleared all endpoints from registry");
  }

  /**
   * Clear endpoints for specific graph type (mainly for testing)
   */
  clearGraph(graphType: string): void {
    this.endpoints.delete(graphType);
    this.logger.debug(`Cleared endpoints for graph type "${graphType}"`);
  }
}

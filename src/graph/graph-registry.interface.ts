// packages/sdk/src/interfaces/graph-registry.interface.ts
import { IGraphService } from "./graph-service.interface";

/**
 * Interface for graph service registry
 */
export interface IGraphServiceRegistry {
  /**
   * Get service client by graph type
   */
  getService(graphType: string): Promise<IGraphService | null>;

  /**
   * Get all available services
   */
  getAllServices(): Promise<Map<string, IGraphService>>;

  /**
   * Register service for a specific graph type
   */
  registerService(graphType: string, service: IGraphService): void;

  /**
   * Remove service
   */
  unregisterService(graphType: string): void;

  /**
   * Refresh registry state (rediscover services)
   */
  refresh(): Promise<void>;
}

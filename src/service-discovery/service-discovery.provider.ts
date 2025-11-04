// packages/graph-services/graph-service-registry/src/service-discovery/service-discovery.provider.ts
/**
 * Service discovery provider - abstract interface
 */
export interface ServiceDiscoveryProvider {
  /**
   * Get list of services by category
   */
  getServices(category: string): Promise<
    Array<{
      name: string;
      address: string;
      port: number;
      metadata: Record<string, any>;
    }>
  >;
}

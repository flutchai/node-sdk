// packages/graph-services/graph-service-registry/src/service-discovery/static.discovery.ts
import { Injectable } from "@nestjs/common";
import { ServiceDiscoveryProvider } from "./service-discovery.provider";

/**
 * Static service discovery provider (for local development)
 */
@Injectable()
export class StaticDiscovery implements ServiceDiscoveryProvider {
  constructor(
    private readonly services: Array<{
      name: string;
      address: string;
      port: number;
      metadata: Record<string, any>;
      category?: string;
    }>
  ) {}

  /**
   * Get list of services by category
   */
  async getServices(category: string): Promise<
    Array<{
      name: string;
      address: string;
      port: number;
      metadata: Record<string, any>;
    }>
  > {
    return this.services.filter(
      service =>
        service.category === category || service.metadata?.category === category
    );
  }
}

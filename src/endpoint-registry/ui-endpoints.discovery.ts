// packages/sdk/src/endpoint-registry/ui-endpoints.discovery.ts
import { Injectable, Logger } from "@nestjs/common";
import { DiscoveryService, MetadataScanner } from "@nestjs/core";
import { EndpointRegistry } from "./endpoint.registry";
import {
  hasUIEndpoints,
  registerUIEndpointsFromClass,
} from "./endpoint.decorators";

/**
 * Service for auto-discovery of UI Endpoints in the application
 * Scans all providers for classes with @WithUIEndpoints decorator
 * and automatically registers them with the EndpointRegistry
 */
@Injectable()
export class UIEndpointsDiscoveryService {
  private readonly logger = new Logger(UIEndpointsDiscoveryService.name);

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly endpointRegistry: EndpointRegistry
  ) {}

  /**
   * Discover and register all UI endpoint classes
   * Called automatically during module initialization
   */
  async discoverUIEndpoints(): Promise<void> {
    this.logger.log("Starting UI endpoints discovery...");

    // Get all providers from the entire application
    const providers = this.discoveryService.getProviders();

    let registeredCount = 0;
    let totalEndpoints = 0;

    for (const provider of providers) {
      try {
        const { instance, metatype } = provider;

        // Skip if no metatype or instance
        if (!metatype || !instance) {
          continue;
        }

        // Check if this class has UI endpoints
        if (hasUIEndpoints(metatype)) {
          this.logger.debug(`Found UI endpoints class: ${metatype.name}`);
          console.log("DEBUG: Discovery found instance", {
            className: metatype.name,
            hasInstance: !!instance,
            instanceType: typeof instance,
          });

          // Register the endpoints from this class
          registerUIEndpointsFromClass(
            this.endpointRegistry,
            metatype,
            instance
          );

          registeredCount++;

          // Count endpoints for logging
          const metadata = this.getUIEndpointMethodsCount(metatype);
          totalEndpoints += metadata;

          this.logger.log(
            `Registered ${metadata} UI endpoints from ${metatype.name}`
          );
        }
      } catch (error) {
        this.logger.warn(`Failed to process provider: ${error.message}`);
      }
    }

    this.logger.log(`UI endpoints discovery completed!`);
    this.logger.log(
      `Stats: ${registeredCount} classes, ${totalEndpoints} endpoints total`
    );

    // Log endpoint registry stats
    const stats = this.endpointRegistry.getStats();
    this.logger.log(
      `Registry: ${stats.totalGraphTypes} graph types, ${stats.totalEndpoints} endpoints`
    );
  }

  /**
   * Get count of UI endpoint methods in a class
   */
  private getUIEndpointMethodsCount(metatype: any): number {
    const { getUIEndpointMethodsMetadata } = require("./endpoint.decorators");
    const methods = getUIEndpointMethodsMetadata(metatype);
    return methods.length;
  }
}

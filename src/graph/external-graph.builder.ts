// packages/sdk/src/external-graph.builder.ts
import { Inject, Injectable } from "@nestjs/common";
import { AbstractGraphBuilder } from "./abstract-graph.builder";
import { CallbackHandler, CallbackRegistry } from "../callbacks";
import { EndpointRegistry } from "../agent-ui";

/**
 * Graph builder for external invocation with callback and endpoint registration.
 *
 * Use this class when your graph needs to register callbacks and endpoints
 * for external HTTP/webhook invocation (i.e. graph microservices).
 *
 * For backend in-process graphs that don't need external registration,
 * extend AbstractGraphBuilder directly instead.
 */
@Injectable()
export abstract class ExternalGraphBuilder<
  V extends string = string,
> extends AbstractGraphBuilder<V> {
  @Inject(CallbackRegistry)
  protected callbackRegistry: CallbackRegistry;

  @Inject(EndpointRegistry)
  protected endpointRegistry: EndpointRegistry;

  constructor() {
    super();

    // Register callbacks and endpoints after the derived class is fully constructed
    setImmediate(() => {
      this.logger.debug(
        `Starting callback registration for ${this.constructor.name}`
      );
      this.registerCallbacks().catch(error => {
        this.logger.error(
          `Failed to register callbacks in constructor: ${error.message}`
        );
      });

      this.logger.debug(
        `Starting endpoint registration for ${this.constructor.name}`
      );
      this.registerEndpoints().catch(error => {
        this.logger.error(
          `Failed to register endpoints in constructor: ${error.message}`
        );
      });
    });
  }

  /**
   * Register callbacks from @Callback decorators
   * This is called automatically after the builder is constructed
   */
  protected async registerCallbacks(): Promise<void> {
    this.logger.log(`CallbackRegistry instance: ${!!this.callbackRegistry}`);

    if (!this.callbackRegistry) {
      this.logger.error(
        "CallbackRegistry not injected! This should not happen."
      );
      return;
    }

    try {
      // Dynamically import decorator utilities to avoid circular dependencies
      const { getCallbackMetadata } = await import(
        "../callbacks/callback.decorators.js"
      );

      // Get callback metadata from the current class
      const callbackMetadata = getCallbackMetadata(this.constructor);

      this.logger.log(
        `Found ${callbackMetadata?.length || 0} callbacks for ${this.constructor.name}`
      );
      this.logger.log(
        `Callback metadata:`,
        JSON.stringify(callbackMetadata, null, 2)
      );

      if (!callbackMetadata || callbackMetadata.length === 0) {
        this.logger.warn(
          `No callbacks found for ${this.constructor.name}. Check @WithCallbacks decorator.`
        );
        return;
      }

      // Get the full graph type for versioned registration
      const fullGraphType = this.graphType;

      // Register each callback with version
      for (const { handler, method } of callbackMetadata) {
        const callbackMethod = (this as any)[method];
        if (typeof callbackMethod === "function") {
          // Create a wrapper that binds the method to this instance
          const boundCallback: CallbackHandler = async context => {
            return callbackMethod.call(this, context);
          };

          // Register with version-specific key
          this.callbackRegistry.register(handler, boundCallback, fullGraphType);

          this.logger.log(
            `Registered callback "${handler}" for graph type "${fullGraphType}"`
          );
        }
      }

      this.logger.log(
        `Registered ${callbackMetadata.length} callbacks for ${this.constructor.name}`
      );
    } catch (error) {
      this.logger.error(
        `Failed to register callbacks: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Register endpoints from @Endpoint decorators
   * This is called automatically after the builder is constructed
   */
  protected async registerEndpoints(): Promise<void> {
    this.logger.log(`EndpointRegistry instance: ${!!this.endpointRegistry}`);

    if (!this.endpointRegistry) {
      this.logger.error(
        "EndpointRegistry not injected! This should not happen."
      );
      return;
    }

    try {
      // Dynamically import decorator utilities to avoid circular dependencies
      const { getEndpointMetadata, createEndpointDescriptors } = await import(
        "../agent-ui"
      );

      // Get endpoint metadata from the current class
      const endpointMetadata = getEndpointMetadata(this.constructor);

      if (!endpointMetadata || endpointMetadata.length === 0) {
        // Only log if we expected endpoints (avoid confusing logs for callback-only builders)
        return;
      }

      this.logger.log(
        `Found ${endpointMetadata.length} endpoints for ${this.constructor.name}`
      );
      this.logger.debug(
        `Endpoint metadata:`,
        JSON.stringify(endpointMetadata, null, 2)
      );

      // Get the full graph type for versioned registration
      const fullGraphType = this.graphType;

      // Create endpoint descriptors and register them
      const endpointDescriptors = createEndpointDescriptors(
        this,
        endpointMetadata
      );

      for (const descriptor of endpointDescriptors) {
        this.endpointRegistry.register(fullGraphType, descriptor);

        this.logger.log(
          `Registered endpoint "${descriptor.name}" for graph type "${fullGraphType}"`
        );
      }

      this.logger.log(
        `Registered ${endpointDescriptors.length} endpoints for ${this.constructor.name}`
      );
    } catch (error) {
      this.logger.error(
        `Failed to register endpoints: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Helper method to manually register endpoints (for classes that don't use decorators)
   * @param endpoints Endpoint descriptors to register
   */
  protected registerEndpointsManually(
    endpoints: import("../agent-ui").EndpointDescriptor[]
  ): void {
    if (!this.endpointRegistry) {
      this.logger.error("EndpointRegistry not available");
      return;
    }

    const fullGraphType = this.graphType;
    for (const endpoint of endpoints) {
      this.endpointRegistry.register(fullGraphType, endpoint);
      this.logger.log(
        `Manually registered endpoint "${endpoint.name}" for graph type "${fullGraphType}"`
      );
    }
  }
}

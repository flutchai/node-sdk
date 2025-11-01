import "reflect-metadata";
import { JSONSchema7 } from "json-schema";
import { EndpointDescriptor } from "./endpoint.registry";

/**
 * Metadata key for storing endpoint information
 */
export const ENDPOINT_METADATA_KEY = "graph:endpoints";

/**
 * Endpoint metadata stored on classes
 */
export interface EndpointMetadata {
  name: string;
  method: "GET" | "POST";
  methodName: string;
  schema?: JSONSchema7;
}

/**
 * Options for endpoint decorator
 */
export interface EndpointOptions {
  method: "GET" | "POST";
  schema?: JSONSchema7;
}

/**
 * Decorator to mark a method as a graph endpoint
 * @param name Endpoint name (e.g., "accounts.list")
 * @param options Endpoint configuration
 */
export function Endpoint(name: string, options: EndpointOptions) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    // Get existing metadata or initialize empty array
    const existingMetadata: EndpointMetadata[] =
      Reflect.getMetadata(ENDPOINT_METADATA_KEY, target.constructor) || [];

    // Add new endpoint metadata
    const metadata: EndpointMetadata = {
      name,
      method: options.method,
      methodName: propertyKey,
      schema: options.schema,
    };

    existingMetadata.push(metadata);

    // Store updated metadata
    Reflect.defineMetadata(
      ENDPOINT_METADATA_KEY,
      existingMetadata,
      target.constructor
    );
  };
}

/**
 * Class decorator to mark a class as having endpoints
 * This ensures the metadata is properly initialized
 */
export function WithEndpoints(target: any) {
  // Initialize metadata if not exists
  if (!Reflect.hasMetadata(ENDPOINT_METADATA_KEY, target)) {
    Reflect.defineMetadata(ENDPOINT_METADATA_KEY, [], target);
  }
}

/**
 * Get endpoint metadata from a class constructor
 * @param constructor The class constructor
 * @returns Array of endpoint metadata
 */
export function getEndpointMetadata(constructor: any): EndpointMetadata[] {
  return Reflect.getMetadata(ENDPOINT_METADATA_KEY, constructor) || [];
}

/**
 * Convert endpoint metadata to endpoint descriptors
 * @param instance The class instance
 * @param metadata Array of endpoint metadata
 * @returns Array of endpoint descriptors
 */
export function createEndpointDescriptors(
  instance: any,
  metadata: EndpointMetadata[]
): EndpointDescriptor[] {
  return metadata.map(meta => ({
    name: meta.name,
    method: meta.method,
    schema: meta.schema,
    handler: async ctx => {
      const method = instance[meta.methodName];
      if (typeof method !== "function") {
        throw new Error(`Method ${meta.methodName} not found on instance`);
      }
      return method.call(instance, ctx);
    },
  }));
}

/**
 * Find endpoint method name by endpoint name
 * @param constructor Class constructor
 * @param endpointName Endpoint name to find
 * @returns Method name or undefined
 */
export function findEndpointMethod(
  constructor: any,
  endpointName: string
): string | undefined {
  const metadata = getEndpointMetadata(constructor);
  const endpoint = metadata.find(meta => meta.name === endpointName);
  return endpoint?.methodName;
}

// === UI ENDPOINTS DECORATORS ===

/**
 * Metadata for UI endpoint classes
 */
export interface UIEndpointClassMetadata {
  graphType: string;
}

export interface UIEndpointMethodMetadata {
  endpointName: string;
  method: "GET" | "POST";
  methodName: string | symbol;
}

const UI_ENDPOINT_CLASS_METADATA_KEY = Symbol("ui_endpoint_class");
const UI_ENDPOINT_METHOD_METADATA_KEY = Symbol("ui_endpoint_methods");

/**
 * Class decorator for UI Endpoints
 * Marks a class as containing UI endpoints for a specific graph type
 *
 * @example
 * ```typescript
 * @WithUIEndpoints('company.financial-ledger::1.0.0')
 * export class LedgerUIEndpoints {
 *   @UIEndpoint('accounts.list', 'GET')
 *   async listAccounts(ctx: RequestContext): Promise<DataEnvelope> { ... }
 * }
 * ```
 */
export function WithUIEndpoints(graphType: string) {
  return function <T extends { new (...args: any[]): {} }>(constructor: T) {
    // Mark class as having UI endpoints
    Reflect.defineMetadata(
      UI_ENDPOINT_CLASS_METADATA_KEY,
      { graphType },
      constructor
    );
    return constructor;
  };
}

/**
 * Method decorator for individual UI endpoints
 *
 * @param endpointName The endpoint name (e.g., 'accounts.list')
 * @param method HTTP method (GET or POST)
 */
export function UIEndpoint(
  endpointName: string,
  method: "GET" | "POST" = "GET"
) {
  return function (
    target: any,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ) {
    // Get existing method metadata
    const existingMethods: UIEndpointMethodMetadata[] =
      Reflect.getMetadata(
        UI_ENDPOINT_METHOD_METADATA_KEY,
        target.constructor
      ) || [];

    // Add new method metadata
    const methodMetadata: UIEndpointMethodMetadata = {
      endpointName,
      method,
      methodName: propertyKey,
    };

    existingMethods.push(methodMetadata);

    // Save updated metadata
    Reflect.defineMetadata(
      UI_ENDPOINT_METHOD_METADATA_KEY,
      existingMethods,
      target.constructor
    );

    return descriptor;
  };
}

/**
 * Get UI endpoint class metadata
 */
export function getUIEndpointClassMetadata(
  constructor: any
): UIEndpointClassMetadata | null {
  return (
    Reflect.getMetadata(UI_ENDPOINT_CLASS_METADATA_KEY, constructor) || null
  );
}

/**
 * Get all UI endpoint methods metadata for a class
 */
export function getUIEndpointMethodsMetadata(
  constructor: any
): UIEndpointMethodMetadata[] {
  return (
    Reflect.getMetadata(UI_ENDPOINT_METHOD_METADATA_KEY, constructor) || []
  );
}

/**
 * Check if a class has UI endpoints
 */
export function hasUIEndpoints(constructor: any): boolean {
  return getUIEndpointClassMetadata(constructor) !== null;
}

/**
 * Register UI endpoints from a class to the endpoint registry
 * @param endpointRegistry The endpoint registry
 * @param EndpointClass The UI endpoints class constructor
 * @param instance Optional pre-created instance (from DI container)
 */
export function registerUIEndpointsFromClass(
  endpointRegistry: any, // EndpointRegistry type
  EndpointClass: any,
  instance?: any
): void {
  // Check if class has UI endpoints
  const classMetadata = getUIEndpointClassMetadata(EndpointClass);
  if (!classMetadata) {
    return;
  }

  // Get method metadata
  const methodsMetadata = getUIEndpointMethodsMetadata(EndpointClass);
  if (methodsMetadata.length === 0) {
    return;
  }

  // Use provided instance or create new one (for backward compatibility)
  console.log("DEBUG: registerUIEndpointsFromClass", {
    hasInstance: !!instance,
    willCreateNew: !instance,
    className: EndpointClass.name,
  });

  const endpointInstance = instance || new EndpointClass();

  // Convert to endpoint descriptors
  const descriptors = methodsMetadata.map(meta => ({
    name: meta.endpointName,
    method: meta.method,
    handler: async (ctx: any) => {
      const method = endpointInstance[meta.methodName as string];
      if (typeof method !== "function") {
        throw new Error(
          `Method ${String(meta.methodName)} not found on instance`
        );
      }
      return method.call(endpointInstance, ctx);
    },
  }));

  // Register all endpoints
  endpointRegistry.registerMultiple(classMetadata.graphType, descriptors);
}

// packages/sdk/src/decorators/callback.decorators.ts

import "reflect-metadata";
import {
  CallbackContext,
  CallbackResult,
} from "../interfaces/callback.interface";

/**
 * Metadata for a registered callback
 */
export interface CallbackMetadata {
  handler: string;
  method: string | symbol;
  target: any;
}

/**
 * Metadata for callback methods
 */
const CALLBACK_METADATA_KEY = Symbol("callbacks");

/**
 * Metadata for classes with callbacks
 */
const CALLBACK_CLASS_METADATA_KEY = Symbol("callback_class");

/**
 * Extended callback context with access to builder
 */
export interface ExtendedCallbackContext extends CallbackContext {
  /** Reference to graph builder for access to its methods and properties */
  builder?: any;
}

/**
 * Type for basic callback handler
 * Re-export for compatibility
 */
export type { CallbackHandler } from "../interfaces/callback.interface";

/**
 * Type for extended callback handler with access to builder
 */
export type ExtendedCallbackHandler = (
  context: ExtendedCallbackContext
) => Promise<CallbackResult>;

/**
 * @Callback decorator for methods
 *
 * @param handler Callback handler name
 *
 * @example
 * ```typescript
 * class LedgerCallbacks {
 *   @Callback('approve-transaction')
 *   async handleApprove(context: CallbackContext): Promise<CallbackResult> {
 *     return { success: true, message: 'Transaction approved' };
 *   }
 * }
 * ```
 */
export function Callback(handler: string) {
  return function (
    target: any,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ) {
    // Get existing metadata
    const existingCallbacks: CallbackMetadata[] =
      Reflect.getMetadata(CALLBACK_METADATA_KEY, target.constructor) || [];

    // Add new callback
    const callbackMetadata: CallbackMetadata = {
      handler,
      method: propertyKey,
      target: target.constructor,
    };

    existingCallbacks.push(callbackMetadata);

    // Save updated metadata
    Reflect.defineMetadata(
      CALLBACK_METADATA_KEY,
      existingCallbacks,
      target.constructor
    );

    // Validate method signature
    if (descriptor.value && typeof descriptor.value === "function") {
      const originalMethod = descriptor.value;

      descriptor.value = function (context: CallbackContext) {
        // Additional validation logic can be added here
        return originalMethod.call(this, context);
      };
    }

    return descriptor;
  };
}

/**
 * @WithCallbacks decorator for builder classes
 * Mixin approach: mixes methods from callback class into builder
 *
 * @param CallbacksClass Class with callbacks
 *
 * @example
 * ```typescript
 * @WithCallbacks(LedgerV1Callbacks)
 * export class LedgerV1Builder extends AbstractGraphBuilder {
 *   // Callbacks automatically become available as builder methods
 * }
 * ```
 */
export function WithCallbacks<T extends { new (...args: any[]): {} }>(
  CallbacksClass: T
) {
  return function <U extends { new (...args: any[]): {} }>(BuilderClass: U) {
    // Get callback metadata from callbacks class
    const callbackMetadata: CallbackMetadata[] =
      Reflect.getMetadata(CALLBACK_METADATA_KEY, CallbacksClass) || [];

    // Create new class extending from builder
    class WithCallbacksBuilder extends BuilderClass {
      constructor(...args: any[]) {
        super(...args);

        // Create instance of callbacks class
        const callbacksInstance = new CallbacksClass();

        // Mix callback methods into current instance
        callbackMetadata.forEach(({ method, handler }) => {
          const callbackMethod = (callbacksInstance as any)[method];
          if (typeof callbackMethod === "function") {
            // Bind method to callbacks instance, but also give access to builder's this
            (this as any)[method] = async (context: CallbackContext) => {
              // Pass builder context to callback through special field
              const enhancedContext = {
                ...context,
                builder: this, // Give access to builder's methods and properties
              };
              return callbackMethod.call(callbacksInstance, enhancedContext);
            };
          }
        });
      }
    }

    // Copy callback metadata to new class
    Reflect.defineMetadata(
      CALLBACK_METADATA_KEY,
      callbackMetadata,
      WithCallbacksBuilder
    );

    // Mark that class has callbacks
    Reflect.defineMetadata(
      CALLBACK_CLASS_METADATA_KEY,
      true,
      WithCallbacksBuilder
    );

    // Copy static properties and methods
    Object.setPrototypeOf(WithCallbacksBuilder, BuilderClass);
    Object.getOwnPropertyNames(BuilderClass).forEach(name => {
      if (name !== "length" && name !== "prototype" && name !== "name") {
        const descriptor = Object.getOwnPropertyDescriptor(BuilderClass, name);
        if (descriptor) {
          Object.defineProperty(WithCallbacksBuilder, name, descriptor);
        }
      }
    });

    return WithCallbacksBuilder as any;
  };
}

/**
 * Gets all registered callbacks for a class
 */
export function getCallbackMetadata(target: any): CallbackMetadata[] {
  return Reflect.getMetadata(CALLBACK_METADATA_KEY, target) || [];
}

/**
 * Checks if a class has callbacks
 */
export function hasCallbacks(target: any): boolean {
  return Reflect.getMetadata(CALLBACK_CLASS_METADATA_KEY, target) === true;
}

/**
 * Finds callback handler method by name
 */
export function findCallbackMethod(
  target: any,
  handler: string
): string | symbol | null {
  const callbacks = getCallbackMetadata(target);
  const callback = callbacks.find(cb => cb.handler === handler);
  return callback ? callback.method : null;
}

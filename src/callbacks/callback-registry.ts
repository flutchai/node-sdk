import { CallbackHandler } from "./callback.interface";

export class CallbackRegistry {
  private handlers = new Map<string, CallbackHandler>();

  /**
   * Register a callback with optional graph type for versioning
   * @param handler Handler name (e.g., "confirm-transaction")
   * @param callback The callback function
   * @param graphType Optional graph type for version-specific registration
   */
  register(
    handler: string,
    callback: CallbackHandler,
    graphType?: string
  ): void {
    // If graphType provided, use versioned key
    const key = graphType ? `${graphType}::${handler}` : handler;
    this.handlers.set(key, callback);

    // Also register without version as fallback (for backward compatibility)
    if (graphType) {
      this.handlers.set(handler, callback);
    }
  }

  /**
   * Get a callback handler, with version-aware lookup
   * @param handler Handler name
   * @param graphType Optional graph type for version-specific lookup
   */
  get(handler: string, graphType?: string): CallbackHandler | undefined {
    // First try version-specific lookup if graphType provided
    if (graphType) {
      const versionedHandler = this.handlers.get(`${graphType}::${handler}`);
      if (versionedHandler) {
        return versionedHandler;
      }
    }

    // Fallback to non-versioned handler
    return this.handlers.get(handler);
  }

  /**
   * List all registered handlers (for debugging)
   */
  listHandlers(): string[] {
    return Array.from(this.handlers.keys());
  }
}

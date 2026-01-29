// packages/sdk/src/abstract-graph.builder.ts
import { Inject, Injectable, Type, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as path from "path";
// Remove dependency on legacy BaseGraphService
import { IGraphRequestPayload, IGraphResponsePayload, IGraphService } from ".";
import {
  CallbackResult,
  CallbackHandler,
  CallbackRegistry,
} from "../callbacks";
import { EndpointRegistry } from "../agent-ui";
import {
  isValidSemver,
  parseCallbackToken as parseCallbackTokenPure,
  decodeCallbackParams,
} from "./graph.logic";

/**
 * Base context interface for graph execution
 * Contains runtime execution data (user, agent, thread, message)
 */
export interface BaseGraphContext {
  messageId?: string;
  threadId: string;
  userId: string;
  agentId: string;
  companyId?: string;
}

/**
 * Base graph configuration interface with common fields from SDK
 * TSettings - graph-specific settings type (e.g., { systemPrompt: string, modelId: string })
 * TContext - extended context type (optional, defaults to BaseGraphContext)
 */
export interface BaseGraphConfig<
  TSettings = any,
  TContext extends BaseGraphContext = BaseGraphContext,
> {
  // LangGraph checkpoint fields (from SDK)
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;

  // Context object - primary source of runtime data
  context: TContext;

  // Metadata from SDK (for compatibility and debugging)
  metadata: {
    userId: string;
    agentId: string;
    requestId: string;
    graphType: string;
    version: string;
    workflowType: string;
  };

  // Graph-specific settings (generic type parameter)
  graphSettings?: TSettings;
}

/**
 * Interface for graph manifest
 */
export interface IGraphManifest {
  // === BASIC INFORMATION ===
  companySlug: string;
  name: string;
  title: string;
  description: string;
  detailedDescription: string;

  // === METADATA ===
  category?: string;
  author?: string;
  maintainer?: string;
  repository?: string;
  tags?: string[];

  // === UI CONFIGURATION (graph level) ===
  ui?: {
    enabled: boolean;
    title: string;
    description?: string;
    defaultScreen: string;
    menu: string[];
    screens: Record<string, any>;
    theme?: Record<string, any>;
    permissions?: Record<string, any>;
  };

  // === VERSIONING ===
  versioning: {
    strategy: "semver";
    defaultVersion: string;
    supportedVersions: string[];
  };

  // === VERSIONS ===
  versions: Record<
    string,
    {
      status: string;
      releaseDate: string;
      isActive: boolean;
      visibility: "public" | "private";
      configSchemaPath?: string;
    }
  >;
}

/**
 * Base abstraction for versioned graphs
 * All graphs should specify only version (e.g. "1.0.0")
 * Full graphType is auto-generated from baseGraphType + version
 */
export abstract class AbstractGraphBuilder<V extends string = string> {
  /**
   * Graph version in semver format (e.g. "1.0.0", "2.1.3")
   */
  abstract readonly version: V;

  protected logger = new Logger(AbstractGraphBuilder.name);

  @Inject(CallbackRegistry)
  protected callbackRegistry: CallbackRegistry;

  @Inject(EndpointRegistry)
  protected endpointRegistry: EndpointRegistry;

  /**
   * Returns full graph type (companySlug.name::version)
   * Auto-generated from manifest's companySlug.name and version
   */
  get graphType(): string {
    // Generate from companySlug.name + version
    if (this.manifest?.companySlug && this.manifest?.name) {
      return `${this.manifest.companySlug}.${this.manifest.name}::${this.version}`;
    }

    // Fallback - will be determined when manifest is loaded
    return `unknown::${this.version}`;
  }

  /**
   * Path to root graph manifest (defaults to graph.manifest.json in root)
   */
  protected manifestPath: string = path.join(
    process.cwd(),
    "graph.manifest.json"
  );

  /**
   * Loaded graph manifest
   */
  protected manifest?: IGraphManifest;

  constructor() {
    // Load manifest synchronously to get correct graphType
    try {
      this.loadManifestSync();
      if (this.manifest) {
        this.logger.debug(
          `Loaded manifest for ${this.manifest.companySlug}.${this.manifest.name} (${this.constructor.name})`
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to load manifest in constructor: ${error.message}`
      );
    }

    // Register callbacks and endpoints after the derived class is fully constructed
    setImmediate(() => {
      this.logger.debug(
        `Starting callback and endpoint registration for ${this.constructor.name}`
      );

      this.registerCallbacks().catch(error => {
        this.logger.error(
          `Failed to register callbacks in constructor: ${error.message}`
        );
      });

      this.registerEndpoints().catch(error => {
        this.logger.error(
          `Failed to register endpoints in constructor: ${error.message}`
        );
      });
    });
  }

  /**
   * Build graph
   */
  abstract buildGraph(config: any): Promise<any>;

  /**
   * Creates execution context for graph with tracer and usageRecorder
   * This method can be overridden in child classes for customization
   */
  protected createGraphContext(
    payload: IGraphRequestPayload
  ): BaseGraphContext {
    return {
      messageId: (payload as any).messageId,
      threadId: payload.threadId,
      userId: payload.userId,
      agentId: payload.agentId,
      companyId: (payload as any).companyId,
    };
  }

  /**
   * Basic configuration preparation for graph execution
   * Automatically creates context with tracer and usageRecorder
   * Handles message deserialization and LangGraph-compatible structure
   * FINAL method - cannot be overridden. Use customizeConfig() hook instead.
   */
  async prepareConfig(payload: IGraphRequestPayload): Promise<any> {
    // DEBUG: Log incoming payload (safe serialization)
    this.logger.debug(
      "[prepareConfig] Incoming payload:",
      JSON.stringify(payload, null, 2)
    );

    const context = this.createGraphContext(payload);

    // Deserialize message if it's a serialized LangChain object
    let message = payload.message;
    if (
      payload.message &&
      typeof payload.message === "object" &&
      "lc" in payload.message
    ) {
      try {
        const { load } = await import("@langchain/core/load");
        message = await load(JSON.stringify(payload.message));
        this.logger.debug({
          message: "Deserialized BaseMessage using load()",
          type: message.constructor?.name,
        });
      } catch (error) {
        this.logger.warn({
          message: "Failed to deserialize message",
          error: error.message,
        });
      }
    }

    // Standard LangGraph-compatible configuration structure
    const baseConfig = {
      // Input for LangGraph (messages array)
      input: message
        ? {
            messages: [message],
          }
        : undefined,

      // Configurable settings for LangGraph checkpointing and context
      configurable: {
        thread_id: payload.threadId,
        checkpoint_ns: this.graphType,
        checkpoint_id: `${payload.threadId}-${Date.now()}`,
        context,

        // Add metadata for compatibility
        metadata: {
          userId: payload.userId,
          agentId: payload.agentId,
          requestId: payload.requestId,
          graphType: this.graphType,
          version: this.version,
          workflowType: this.graphType,
        },

        // Graph-specific settings from payload
        graphSettings: payload.graphSettings || {},
      },
    };

    // Call customization hook - child classes can override this
    const finalConfig = await this.customizeConfig(baseConfig, payload);

    // DEBUG: Log final config (safe serialization - skip circular references)
    try {
      const configCopy = JSON.parse(
        JSON.stringify(finalConfig, (key, value) => {
          // Skip circular references and non-serializable objects
          if (key === "checkpointer" || key === "saver")
            return "[Checkpointer]";
          return value;
        })
      );
      this.logger.debug(
        "[prepareConfig] Final config:",
        JSON.stringify(configCopy, null, 2)
      );
    } catch (err) {
      this.logger.debug("[prepareConfig] Final config (structure only):", {
        hasInput: !!finalConfig.input,
        configurableKeys: Object.keys(finalConfig.configurable || {}),
      });
    }

    return finalConfig;
  }

  /**
   * Hook for customizing config after base preparation
   * Override this method in child classes to add/modify config fields
   *
   * @param config - Base config prepared by SDK
   * @param payload - Original request payload
   * @returns Modified config
   *
   * @example
   * ```typescript
   * protected async customizeConfig(config: any, payload: IGraphRequestPayload): Promise<any> {
   *   // Add custom fields
   *   config.configurable.myCustomField = "value";
   *
   *   // Modify existing fields
   *   config.configurable.context.customData = await this.loadCustomData(payload);
   *
   *   return config;
   * }
   * ```
   */
  protected async customizeConfig(
    config: any,
    payload: IGraphRequestPayload
  ): Promise<any> {
    // Default implementation - just return config as is
    return config;
  }

  /**
   * Load graph manifest (if using manifest-based approach)
   */
  protected async loadManifest(): Promise<IGraphManifest | null> {
    if (!this.manifestPath) {
      return null;
    }

    try {
      const fs = await import("fs/promises");
      const path = await import("path");

      const manifestFullPath = path.resolve(this.manifestPath);
      const manifestContent = await fs.readFile(manifestFullPath, "utf-8");
      const manifest = JSON.parse(manifestContent) as IGraphManifest;

      // Manifest validation disabled - new structure is used
      // this.validateManifest(manifest);

      this.manifest = manifest;
      return manifest;
    } catch (error) {
      console.error(
        `Failed to load manifest from ${this.manifestPath}: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  /**
   * Synchronous manifest loading for use in constructor
   */
  protected loadManifestSync(): IGraphManifest | null {
    if (!this.manifestPath) {
      return null;
    }

    try {
      const fs = require("fs");
      const path = require("path");

      const manifestFullPath = path.resolve(this.manifestPath);
      const manifestContent = fs.readFileSync(manifestFullPath, "utf-8");
      const manifest = JSON.parse(manifestContent) as IGraphManifest;

      // Manifest validation disabled - new structure is used
      // this.validateManifest(manifest);

      this.manifest = manifest;
      return manifest;
    } catch (error) {
      console.error(
        `Failed to load manifest from ${this.manifestPath}: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  /**
   * Validate graph manifest
   */
  protected validateManifest(manifest: IGraphManifest): void {
    // Validation temporarily disabled for new manifest structure
    // TODO: Create new validator for structure with baseType and versions
    // GraphManifestValidator.validateOrThrow(manifest);
  }

  /**
   * Get graph metadata (from manifest or decorator)
   */
  async getGraphMetadata(): Promise<IGraphManifest | null> {
    if (this.manifest) {
      return this.manifest;
    }

    return await this.loadManifest();
  }

  /**
   * Get specific version configuration of the graph
   */
  async getVersionConfig() {
    const manifest = await this.loadManifest();
    if (!manifest) {
      throw new Error(`Manifest not found at ${this.manifestPath}`);
    }

    const versionConfig = manifest.versions[this.version];
    if (!versionConfig) {
      throw new Error(`Version ${this.version} not found in manifest`);
    }

    // Load config schema if path is specified
    let configSchema = null;
    if (versionConfig.configSchemaPath) {
      try {
        const fs = await import("fs/promises");
        const schemaPath = path.resolve(
          process.cwd(),
          versionConfig.configSchemaPath
        );
        const schemaContent = await fs.readFile(schemaPath, "utf-8");
        const schemaData = JSON.parse(schemaContent);
        configSchema = schemaData.schema;
      } catch (error) {
        this.logger.warn(`Failed to load config schema: ${error.message}`);
      }
    }

    return {
      // Basic graph information
      companySlug: manifest.companySlug,
      name: manifest.name,
      title: manifest.title,
      description: manifest.description,
      detailedDescription: manifest.detailedDescription,
      category: manifest.category,
      tags: manifest.tags,

      // UI configuration
      ui: manifest.ui,

      // Version information
      ...versionConfig,

      // Config schema (if exists)
      configSchema,

      // Full graphType for compatibility
      graphType: this.graphType,
      version: this.version,
    };
  }

  /**
   * Get full graph type
   * REQUIRES baseGraphType - no more legacy support!
   */
  getFullGraphType(baseGraphType: string): string {
    if (!baseGraphType) {
      throw new Error("baseGraphType is required for versioned graphs");
    }

    return `${baseGraphType}::${this.version}`;
  }

  /**
   * Version validation
   */
  validateVersion(): boolean {
    if (!isValidSemver(this.version)) {
      throw new Error(
        `Invalid version format: ${this.version}. Expected format: X.Y.Z`
      );
    }
    return true;
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
      const fullGraphType = this.graphType; // This should return the full type like "company.financial-ledger::1.0.0"

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
      const fullGraphType = this.graphType; // This should return the full type like "ledger::1.0.0"

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

/**
 * Interface for graph engine
 */
export interface IGraphEngine {
  invokeGraph(graph: any, config: any, signal?: AbortSignal): Promise<any>;
  streamGraph(
    graph: any,
    config: any,
    onPartial: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<any>;
}

/**
 * Universal graph service that delegates execution to builder and engine
 */
@Injectable()
export class UniversalGraphService implements IGraphService {
  readonly logger = new Logger(UniversalGraphService.name);

  constructor(
    protected readonly configService: ConfigService,
    @Inject("GRAPH_BUILDERS")
    private readonly builders: AbstractGraphBuilder<string>[],
    @Inject("GRAPH_ENGINE")
    private readonly engine: IGraphEngine,
    @Inject(EndpointRegistry)
    private readonly endpointRegistry: EndpointRegistry
  ) {
    this.logger.log("UniversalGraphService initialized");
    if (!this.engine) {
      this.logger.error("GRAPH_ENGINE is not properly injected!");
    }
  }

  /**
   * Returns graph types supported by the service
   */
  async getSupportedGraphTypes(): Promise<string[]> {
    // console.log('Registered builders:', this.builders);
    return this.builders.map(builder => {
      // console.log(`Builder: ${builder.constructor.name}, graphType:`, builder.graphType);
      return builder.graphType;
    });
  }

  /**
   * Generate answer without streaming
   */
  async generateAnswer(
    payload: IGraphRequestPayload
  ): Promise<IGraphResponsePayload> {
    const builder = this.getBuilderForType(payload.graphType);

    // Build graph
    const graph = await builder.buildGraph(payload);

    // Prepare execution configuration
    const config = await builder.prepareConfig(payload);

    // Track generation cancellation
    const abortController = new AbortController();
    this.registerActiveGeneration(payload.requestId, () => {
      abortController.abort();
    });

    try {
      // Execute graph through engine
      const result = await this.engine.invokeGraph(
        graph,
        config,
        abortController.signal
      );

      // Form response
      return {
        requestId: payload.requestId,
        text: result.text || "",
        attachments: result.attachments || [],
        metadata: result.metadata || {},
        reasoningChains: result.reasoningChains || [], // Add reasoning chains
      };
    } finally {
      this.unregisterActiveGeneration(payload.requestId);
    }
  }

  /**
   * Stream answer generation
   */
  async streamAnswer(payload, onPartial) {
    this.logger.debug(
      `>>> Entering streamAnswer with requestId: ${payload.requestId}`
    );
    const abortController = new AbortController();

    try {
      // Existing code remains here
      const builder = this.getBuilderForType(payload.graphType);
      this.logger.debug(`Got builder for graph type: ${payload.graphType}`);

      // Build graph
      const graph = await builder.buildGraph(payload);
      this.logger.debug(`Graph built for requestId: ${payload.requestId}`);

      // Prepare execution configuration
      this.logger.debug(`Preparing config for requestId: ${payload.requestId}`);
      const config = await builder.prepareConfig(payload);
      this.logger.debug(`Config prepared`);

      // Track generation cancellation
      this.registerActiveGeneration(payload.requestId, () => {
        abortController.abort();
      });
      this.logger.debug(`Active generation registered: ${payload.requestId}`);

      this.logger.debug(
        `Calling engine.streamGraph for requestId: ${payload.requestId}`
      );
      const result = await this.engine.streamGraph(
        graph,
        config,
        onPartial,
        abortController.signal
      );

      this.logger.debug(`[STREAM-RESULT] Engine returned:`, {
        hasText: !!result.text,
        textLength: result.text?.length || 0,
        attachmentsCount: result.attachments?.length || 0,
        reasoningChainsCount: result.reasoningChains?.length || 0,
        resultKeys: Object.keys(result || {}),
      });

      // Form response
      return {
        requestId: payload.requestId,
        text: result.text || "",
        attachments: result.attachments || [],
        metadata: result.metadata || {},
        reasoningChains: result.reasoningChains || [], // Add reasoning chains
      };
    } catch (error) {
      this.logger.error(`Error in streamAnswer: ${error.message}`);
      this.logger.error(`Stack trace: ${error.stack}`);
      throw error; // Rethrow error
    } finally {
      abortController.abort();
      this.unregisterActiveGeneration(payload.requestId);
    }
  }

  /**
   * Service health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Check that there are registered builders
      if (this.builders.length === 0) {
        this.logger.warn("No builders registered");
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(`Health check failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Cancel generation
   */
  async cancelGeneration(requestId: string): Promise<void> {
    const generation = this.activeGenerations.get(requestId);

    if (generation) {
      generation.cancel();
      this.activeGenerations.delete(requestId);
      this.logger.log(`Cancelled generation for request: ${requestId}`);
    } else {
      this.logger.warn(`No active generation found for request: ${requestId}`);
    }
  }

  // Active generations that can be cancelled
  private readonly activeGenerations = new Map<
    string,
    { cancel: () => void }
  >();

  /**
   * Register active generation
   */
  private registerActiveGeneration(
    requestId: string,
    cancel: () => void
  ): void {
    this.activeGenerations.set(requestId, { cancel });

    // Automatic cleanup after 10 minutes
    setTimeout(
      () => {
        if (this.activeGenerations.has(requestId)) {
          this.activeGenerations.delete(requestId);
          this.logger.debug(
            `Auto-cleaned generation for request: ${requestId}`
          );
        }
      },
      10 * 60 * 1000
    );
  }

  /**
   * Remove active generation
   */
  private unregisterActiveGeneration(requestId: string): void {
    this.activeGenerations.delete(requestId);
  }

  /**
   * Execute callback through decorators
   */
  async executeCallback(
    token: string,
    platform?: string,
    platformContext?: any
  ): Promise<CallbackResult> {
    this.logger.debug(`Executing callback with token: ${token}`);

    try {
      // Try to find callback among builders through decorators
      const result = await this.executeCallbackFromDecorators(
        token,
        platform,
        platformContext
      );

      if (result) {
        return result;
      }

      // If not found through decorators, try old system (SmartCallbackRouter)
      // TODO: integrate with existing callback system if backward compatibility is needed

      return {
        success: false,
        error: "Callback handler not found",
      };
    } catch (error) {
      this.logger.error(
        `Error executing callback: ${error instanceof Error ? error.message : String(error)}`
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Execute callback through decorator system
   */
  private async executeCallbackFromDecorators(
    token: string,
    platform?: string,
    platformContext?: any
  ): Promise<CallbackResult | null> {
    // Import functions for working with decorators
    const { getCallbackMetadata, findCallbackMethod } = await import(
      "../callbacks/callback.decorators.js"
    );

    // Parse token to extract graph type and handler
    const { graphType, handler } = this.parseCallbackToken(token);

    // Find builder for this graph type
    const builder = this.builders.find(b => b.graphType === graphType);
    if (!builder) {
      this.logger.warn(`No builder found for graph type: ${graphType}`);
      return null;
    }

    // Find callback method in builder
    const methodName = findCallbackMethod(builder.constructor, handler);
    if (!methodName || typeof (builder as any)[methodName] !== "function") {
      this.logger.warn(
        `No callback method found for handler: ${handler} in ${graphType}`
      );
      return null;
    }

    // Create callback context
    const context = {
      userId: platformContext?.userId || "unknown",
      threadId: platformContext?.threadId,
      agentId: platformContext?.agentId,
      params: this.parseCallbackParams(token),
      platform,
      metadata: {
        token,
        platformContext,
        graphType,
        handler,
      },
    };

    // Call callback method
    this.logger.debug(`Executing callback ${handler} on builder ${graphType}`);
    const result = await (builder as any)[methodName](context);

    return result;
  }

  /**
   * Parse callback token to extract information
   * Expected format: cb_{graphName}_{handler}_{encodedParams}
   */
  private parseCallbackToken(token: string): {
    graphType: string;
    handler: string;
  } {
    const result = parseCallbackTokenPure(token);
    if (!result) {
      throw new Error(`Invalid callback token format: ${token}`);
    }
    return result;
  }

  /**
   * Extract parameters from callback token
   */
  private parseCallbackParams(token: string): Record<string, any> {
    const result = decodeCallbackParams(token);
    if (Object.keys(result).length === 0 && token.split("_").length >= 4) {
      this.logger.warn(`Failed to parse callback params from token: ${token}`);
    }
    return result;
  }

  /**
   * Call a graph endpoint
   * @param graphType Graph type
   * @param endpointName Endpoint name
   * @param context Request context
   * @returns Response envelope
   */
  async callEndpoint(
    graphType: string,
    endpointName: string,
    context: import("../agent-ui").RequestContext
  ): Promise<import("../agent-ui").DataEnvelope> {
    this.logger.debug(
      `Calling endpoint "${endpointName}" for graph "${graphType}"`
    );

    return await this.endpointRegistry.call(graphType, endpointName, context);
  }

  /**
   * List all endpoints for a graph type
   * @param graphType Graph type
   * @returns Array of endpoint names
   */
  listEndpoints(graphType: string): string[] {
    return this.endpointRegistry.list(graphType);
  }

  /**
   * List all graph types that have endpoints
   * @returns Array of graph types
   */
  listGraphTypesWithEndpoints(): string[] {
    return this.endpointRegistry.listGraphTypes();
  }

  /**
   * Get builder for specified graph type
   */
  private getBuilderForType(graphType: string): AbstractGraphBuilder<string> {
    const builder = this.builders.find(b => b.graphType === graphType);

    if (!builder) {
      throw new Error(`No builder found for graph type: ${graphType}`);
    }

    return builder;
  }
}

// packages/sdk/src/universal-graph.module.ts
import {
  DynamicModule,
  Module,
  Provider,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import {
  UniversalGraphService,
  AbstractGraphBuilder,
} from "./abstract-graph.builder";
import {
  GraphEngineFactory,
  GraphEngineType,
} from "../engine/graph-engine.factory";
import { BuilderRegistryService } from "./builder-registry.service";
import { GraphController } from "../api/graph.controller";
import { VersionedGraphService, VersioningConfig } from "../versioning";
import { IGraphRequestPayload } from "../interfaces";
import { GraphTypeUtils } from "../utils/graph-type.utils";
import { EventProcessor } from "../engine/event-processor.utils";
// Remove static Redis import to avoid early connection attempts
import { Registry } from "prom-client";
import { DiscoveryModule, MetadataScanner } from "@nestjs/core";
import { LangGraphEngine } from "../engine/langgraph-engine";
import {
  CallbackStore,
  CallbackRegistry,
  SmartCallbackRouter,
  UniversalCallbackService,
  registerFinanceExampleCallback,
  CallbackACL,
  CallbackAuditor,
  CallbackMetrics,
  CallbackRateLimiter,
  IdempotencyManager,
  CallbackPatchService,
  TelegramPatchHandler,
  WebPatchHandler,
} from "../callbacks";
import { CallbackController } from "../api/callback.controller";
import { UIDispatchController } from "../api/ui-dispatch.controller";
import { CallbackTokenGuard } from "../api/callback-token.guard";
import { EndpointRegistry } from "../endpoint-registry";
import { UIEndpointsDiscoveryService } from "../endpoint-registry/ui-endpoints.discovery";

/**
 * Options for UniversalGraphModule configuration
 */
export interface UniversalGraphModuleOptions {
  /** Graph engine type */
  engineType?: GraphEngineType;
  /** Versioning configurations for graphs */
  versioning?: VersioningConfig[];
}

/**
 * Create simple meta-builder for versioning
 */
function createMetaBuilder(
  config: VersioningConfig,
  versionedGraphService: VersionedGraphService,
  moduleRef: ModuleRef,
  callbackRegistry: CallbackRegistry,
  endpointRegistry: EndpointRegistry
) {
  // Create dynamic class with meaningful name
  const className = `${config.baseGraphType.replace(/\./g, "")}VersionRouter`;

  class VersionRouter extends AbstractGraphBuilder<any> {
    readonly version = "router" as any; // Version router

    // Inject CallbackRegistry and EndpointRegistry manually since we can't use decorators in dynamic classes
    constructor() {
      super();
      // Manually assign the registry instances
      (this as any).callbackRegistry = callbackRegistry;
      (this as any).endpointRegistry = endpointRegistry;
    }

    // Override graphType to display base type
    get graphType(): string {
      return config.baseGraphType;
    }

    async buildGraph(payload: IGraphRequestPayload): Promise<any> {
      const graphType = payload.graphSettings?.graphType;
      if (!graphType) {
        throw new Error("GraphType is required in payload.graphSettings");
      }

      const resolution = await versionedGraphService.resolveVersion(graphType, {
        strict: false,
      });

      // Try to get existing instance, fallback to creating new one
      try {
        const versionedBuilder = moduleRef.get(resolution.builderClass, {
          strict: false,
        });
        return versionedBuilder.buildGraph(payload);
      } catch (error) {
        // Fallback: create instance manually
        const versionedBuilder = await moduleRef.create(
          resolution.builderClass
        );
        return versionedBuilder.buildGraph(payload);
      }
    }

    async prepareConfig(payload: IGraphRequestPayload): Promise<any> {
      const graphType = payload.graphSettings?.graphType;
      if (!graphType) {
        throw new Error("GraphType is required in payload.graphSettings");
      }

      const resolution = await versionedGraphService.resolveVersion(graphType, {
        strict: false,
      });

      // Try to get existing instance, fallback to creating new one
      let versionedBuilder;
      try {
        versionedBuilder = moduleRef.get(resolution.builderClass, {
          strict: false,
        });
      } catch (error) {
        versionedBuilder = await moduleRef.create(resolution.builderClass);
      }

      const updatedPayload = {
        ...payload,
        graphSettings: {
          ...payload.graphSettings,
          graphType: resolution.fullGraphType,
        },
      };

      return versionedBuilder.prepareConfig(updatedPayload);
    }
  }

  // Set meaningful name for the class
  Object.defineProperty(VersionRouter, "name", { value: className });

  return VersionRouter;
}

@Module({})
export class UniversalGraphModule {
  static forRoot(options: UniversalGraphModuleOptions): DynamicModule {
    const providers: Provider[] = [
      // Event processor for stream handling
      EventProcessor,
      // Graph engines
      LangGraphEngine,
      BuilderRegistryService,
      GraphEngineFactory,
      VersionedGraphService,
      UniversalGraphService,
      // Callback infrastructure - Redis client (ioredis or ioredis-mock via main.ts interceptor)
      {
        provide: "REDIS_CLIENT",
        useFactory: () => {
          const Redis = require("ioredis");
          return new Redis(process.env.REDIS_URL || "redis://redis:6379");
        },
      },
      {
        provide: "PROMETHEUS_REGISTRY",
        useValue: new Registry(),
      },
      {
        provide: CallbackStore,
        useFactory: (redis: any) => new CallbackStore(redis),
        inject: ["REDIS_CLIENT"],
      },
      {
        provide: CallbackRegistry,
        useClass: CallbackRegistry,
      },
      {
        provide: EndpointRegistry,
        useClass: EndpointRegistry,
      },
      {
        provide: UIEndpointsDiscoveryService,
        useClass: UIEndpointsDiscoveryService,
      },
      {
        provide: CallbackACL,
        useClass: CallbackACL,
      },
      {
        provide: CallbackAuditor,
        useClass: CallbackAuditor,
      },
      {
        provide: CallbackMetrics,
        useFactory: (registry: Registry) => new CallbackMetrics(registry),
        inject: ["PROMETHEUS_REGISTRY"],
      },
      {
        provide: CallbackRateLimiter,
        useFactory: (redis: any) => new CallbackRateLimiter(redis),
        inject: ["REDIS_CLIENT"],
      },
      {
        provide: IdempotencyManager,
        useFactory: (redis: any) => new IdempotencyManager(redis),
        inject: ["REDIS_CLIENT"],
      },
      {
        provide: TelegramPatchHandler,
        useClass: TelegramPatchHandler,
      },
      {
        provide: WebPatchHandler,
        useClass: WebPatchHandler,
      },
      {
        provide: CallbackPatchService,
        useFactory: (telegram: TelegramPatchHandler, web: WebPatchHandler) =>
          new CallbackPatchService(telegram, web),
        inject: [TelegramPatchHandler, WebPatchHandler],
      },
      {
        provide: SmartCallbackRouter,
        useFactory: (
          registry: CallbackRegistry,
          store: CallbackStore,
          acl: CallbackACL,
          auditor: CallbackAuditor,
          metrics: CallbackMetrics,
          rateLimiter: CallbackRateLimiter,
          idempotencyManager: IdempotencyManager,
          patchService: CallbackPatchService
        ) =>
          new SmartCallbackRouter(
            registry,
            store,
            acl,
            auditor,
            metrics,
            rateLimiter,
            idempotencyManager,
            patchService
          ),
        inject: [
          CallbackRegistry,
          CallbackStore,
          CallbackACL,
          CallbackAuditor,
          CallbackMetrics,
          CallbackRateLimiter,
          IdempotencyManager,
          CallbackPatchService,
        ],
      },
      {
        provide: UniversalCallbackService,
        useFactory: (store: CallbackStore, router: SmartCallbackRouter) =>
          new UniversalCallbackService(store, router),
        inject: [CallbackStore, SmartCallbackRouter],
      },
      {
        provide: CallbackTokenGuard,
        useFactory: (store: CallbackStore, acl: CallbackACL) =>
          new CallbackTokenGuard(store, acl),
        inject: [CallbackStore, CallbackACL],
      },
      {
        provide: "CALLBACK_EXAMPLE_REGISTRATION",
        useFactory: (registry: CallbackRegistry) => {
          registerFinanceExampleCallback(registry);
        },
        inject: [CallbackRegistry],
      },
      {
        provide: "UI_ENDPOINTS_DISCOVERY",
        useFactory: async (discoveryService: UIEndpointsDiscoveryService) => {
          // Auto-discover and register all UI endpoints from the entire application
          await discoveryService.discoverUIEndpoints();
          return true;
        },
        inject: [UIEndpointsDiscoveryService],
      },
      {
        provide: "GRAPH_ENGINE",
        useFactory: (factory: GraphEngineFactory) => {
          return factory.getEngine(
            options.engineType || GraphEngineType.LANGGRAPH
          );
        },
        inject: [GraphEngineFactory],
      },
      {
        provide: "GRAPH_BUILDERS",
        useFactory: (registry: BuilderRegistryService) => {
          return registry.getBuilders(); // Get builders from registry
        },
        inject: [BuilderRegistryService],
      },
      {
        provide: "GRAPH_SERVICE",
        useExisting: UniversalGraphService,
      },
      {
        provide: "VERSIONING_CONFIGS",
        useValue: options.versioning || [],
      },
      // Automatic versioning initialization (synchronous)
      {
        provide: "VERSIONING_INITIALIZER",
        useFactory: (
          builderRegistry: BuilderRegistryService,
          versionedGraphService: VersionedGraphService,
          configs: VersioningConfig[],
          callbackRegistry: CallbackRegistry,
          moduleRef: ModuleRef,
          endpointRegistry: EndpointRegistry
        ) => {
          console.log(
            "🔧 VERSIONING_INITIALIZER running with configs:",
            configs?.length || 0
          );
          console.log("🔧 ModuleRef available:", !!moduleRef);
          console.log("🔧 BuilderRegistry available:", !!builderRegistry);

          // Deferred initialization - register configurations
          configs.forEach(config =>
            versionedGraphService.registerVersioning(config)
          );

          // Create and register version routers synchronously
          configs.forEach(config => {
            if (moduleRef) {
              const VersionRouterClass = createMetaBuilder(
                config,
                versionedGraphService,
                moduleRef,
                callbackRegistry,
                endpointRegistry
              );
              const versionRouter = new VersionRouterClass();
              console.log(
                "🔧 Registering VersionRouter for",
                config.baseGraphType
              );
              builderRegistry.registerBuilder(versionRouter);
            } else {
              // Fallback: create simple meta-builder without ModuleRef dependency
              class SimpleVersionRouter extends AbstractGraphBuilder<any> {
                readonly version = "router" as any;

                constructor() {
                  super();
                  // Manually assign the registry instances
                  (this as any).callbackRegistry = callbackRegistry;
                  (this as any).endpointRegistry = endpointRegistry;
                }

                get graphType(): string {
                  return config.baseGraphType;
                }

                async buildGraph(payload: any): Promise<any> {
                  throw new Error(
                    "ModuleRef not available - cannot build graph"
                  );
                }

                async prepareConfig(payload: any): Promise<any> {
                  throw new Error(
                    "ModuleRef not available - cannot prepare config"
                  );
                }
              }

              const simpleRouter = new SimpleVersionRouter();
              console.log(
                "🔧 Registering SimpleRouter for",
                config.baseGraphType,
                "(no ModuleRef)"
              );
              builderRegistry.registerBuilder(simpleRouter);
            }
          });

          return true;
        },
        inject: [
          BuilderRegistryService,
          VersionedGraphService,
          "VERSIONING_CONFIGS",
          CallbackRegistry,
          ModuleRef,
          EndpointRegistry,
        ],
      },
    ];

    return {
      global: true,
      module: UniversalGraphModule,
      imports: [ConfigModule.forRoot({ isGlobal: true }), DiscoveryModule],
      controllers: [GraphController, CallbackController, UIDispatchController],
      providers,
      exports: [
        "GRAPH_SERVICE",
        "GRAPH_ENGINE",
        UniversalGraphService,
        BuilderRegistryService,
        VersionedGraphService,
        UniversalCallbackService,
        CallbackStore,
        CallbackRegistry,
        EndpointRegistry,
        UIEndpointsDiscoveryService,
      ],
    };
  }
}

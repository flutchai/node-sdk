// packages/sdk/src/universal-graph.module.ts
import { DynamicModule, Module, Provider, Logger } from "@nestjs/common";
import { ModuleRef, DiscoveryModule, MetadataScanner } from "@nestjs/core";
import { ConfigModule, ConfigService } from "@nestjs/config";
import mongoose, { Connection } from "mongoose";
import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { createMongoClientAdapter } from "./mongodb";
import {
  AbstractGraphBuilder,
  IGraphRequestPayload,
  GraphController,
  UniversalGraphService,
  VersionedGraphService,
  VersioningConfig,
} from "../graph";
import {
  EventProcessor,
  GraphEngineFactory,
  GraphEngineType,
  LangGraphEngine,
} from "../engines";
import { BuilderRegistryService } from "./builder-registry.service";
import { Registry } from "prom-client";
import {
  CallbackStore,
  CallbackRegistry,
  CallbackController,
  CallbackTokenGuard,
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
import {
  EndpointRegistry,
  UIEndpointsDiscoveryService,
  UIDispatchController,
} from "../agent-ui";

/**
 * MongoDB configuration options
 */
export interface MongoDBConfig {
  /** MongoDB connection URI */
  uri?: string;
  /** Database name */
  dbName?: string;
  /** Checkpoint collection name */
  checkpointCollectionName?: string;
  /** Checkpoint writes collection name */
  checkpointWritesCollectionName?: string;
}

/**
 * Options for UniversalGraphModule configuration
 */
export interface UniversalGraphModuleOptions {
  /** Graph engine type */
  engineType?: GraphEngineType;
  /** Versioning configurations for graphs */
  versioning?: VersioningConfig[];
  /** MongoDB configuration for checkpointer */
  mongodb?: MongoDBConfig;
}

/**
 * Create simple meta-builder for versioning
 */
function createMetaBuilder(
  config: VersioningConfig,
  versionedGraphService: VersionedGraphService,
  moduleRef: ModuleRef
) {
  // Create dynamic class with meaningful name
  const className = `${config.baseGraphType.replace(/\./g, "")}VersionRouter`;

  class VersionRouter extends AbstractGraphBuilder<any> {
    readonly version = "router" as any; // Version router

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
      // Discovery services from @nestjs/core
      MetadataScanner,
      // Event processor for stream handling
      {
        provide: EventProcessor,
        useFactory: () => new EventProcessor(),
      },
      // Graph engines
      {
        provide: LangGraphEngine,
        useFactory: (eventProcessor: EventProcessor) =>
          new LangGraphEngine(eventProcessor, undefined),
        inject: [EventProcessor],
      },
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
      EndpointRegistry,
      UIEndpointsDiscoveryService,
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
      // MongoDB connection (optional - only if mongodb config provided)
      ...(options.mongodb
        ? [
            {
              provide: "MONGO_CONNECTION",
              useFactory: async (
                configService: ConfigService
              ): Promise<Connection> => {
                const logger = new Logger("UniversalGraphModule");
                const mongoUri =
                  options.mongodb?.uri ||
                  configService.get<string>("MONGODB_URI") ||
                  process.env.MONGODB_URI;
                const dbName =
                  options.mongodb?.dbName ||
                  configService.get<string>("MONGO_DB_NAME") ||
                  process.env.MONGO_DB_NAME;

                if (!mongoUri) {
                  throw new Error(
                    "MONGODB_URI is not defined in options, config, or environment"
                  );
                }

                logger.log(
                  `Connecting to MongoDB: ${mongoUri?.substring(0, 50) + "..."}`
                );
                try {
                  await mongoose.connect(mongoUri, { dbName });
                  logger.log(
                    `Successfully connected to MongoDB (db: ${dbName})`
                  );
                  return mongoose.connection;
                } catch (error) {
                  logger.error("Failed to connect to MongoDB", error as Error);
                  throw error;
                }
              },
              inject: [ConfigService],
            },
            // MongoDB checkpointer
            {
              provide: "CHECKPOINTER",
              useFactory: async (
                connection: Connection,
                configService: ConfigService
              ) => {
                const logger = new Logger("UniversalGraphModule");
                const dbName =
                  options.mongodb?.dbName ||
                  configService.get<string>("MONGO_DB_NAME") ||
                  process.env.MONGO_DB_NAME;
                const checkpointCollectionName =
                  options.mongodb?.checkpointCollectionName || "checkpoints";
                const checkpointWritesCollectionName =
                  options.mongodb?.checkpointWritesCollectionName ||
                  "checkpoint_writes";

                logger.log(
                  `Creating CHECKPOINTER with collections: ${checkpointCollectionName}, ${checkpointWritesCollectionName}`
                );

                const mongooseClient = connection.getClient();
                const mongoClient = createMongoClientAdapter(mongooseClient);

                return new MongoDBSaver({
                  client: mongoClient,
                  dbName,
                  checkpointCollectionName,
                  checkpointWritesCollectionName,
                });
              },
              inject: ["MONGO_CONNECTION", ConfigService],
            },
          ]
        : []),
      {
        provide: "GRAPH_ENGINE",
        useFactory: (langGraphEngine: LangGraphEngine) => langGraphEngine,
        inject: [LangGraphEngine],
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
          moduleRef: ModuleRef
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
                moduleRef
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
          ModuleRef,
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

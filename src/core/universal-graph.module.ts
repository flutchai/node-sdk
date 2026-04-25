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
 * MongoDB configuration for conversation checkpointing.
 */
export interface MongoDBConfig {
  /** MongoDB connection URI. Falls back to MONGODB_URI env var. */
  uri?: string;
  /** Database name. Falls back to MONGO_DB_NAME env var. */
  dbName?: string;
  /** Checkpoint collection name (default: "checkpoints") */
  checkpointCollectionName?: string;
  /** Checkpoint writes collection name (default: "checkpoint_writes") */
  checkpointWritesCollectionName?: string;
}

/**
 * PostgreSQL configuration for conversation checkpointing.
 *
 * Requires `@langchain/langgraph-checkpoint-postgres` to be installed.
 *
 * @example
 * UniversalGraphModule.forRoot({
 *   postgres: { connectionString: process.env.DATABASE_URL },
 * })
 */
export interface PostgresConfig {
  /**
   * PostgreSQL connection string.
   * Falls back to DATABASE_URL env var when not provided.
   *
   * @example "postgresql://user:pass@localhost:5432/mydb"
   */
  connectionString?: string;
  /**
   * Database schema for checkpoint tables (default: "public").
   * Useful for multi-tenant setups.
   */
  schema?: string;
}

/**
 * Options for UniversalGraphModule.forRoot()
 */
export interface UniversalGraphModuleOptions {
  /** Graph engine type (default: LANGGRAPH) */
  engineType?: GraphEngineType;
  /** Versioning configurations for graphs */
  versioning?: VersioningConfig[];
  /**
   * Redis connection URL for the callback system (idempotency, rate limiting, state).
   * Falls back to REDIS_URL env var.
   * If neither is provided, an in-memory store is used — fine for single-instance
   * deployments but not suitable for horizontal scaling.
   */
  redis?: { url: string };
  /**
   * Postgres checkpointer — recommended for new projects.
   * Re-uses the same Postgres instance as the rest of the app.
   * Requires `@langchain/langgraph-checkpoint-postgres` peer dependency.
   */
  postgres?: PostgresConfig;
  /**
   * MongoDB checkpointer — use if your app already runs MongoDB.
   * Requires `mongoose` peer dependency.
   */
  mongodb?: MongoDBConfig;
  // If neither postgres nor mongodb is configured, the module falls back to
  // an in-memory checkpointer (no persistence across restarts).
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
      const graphType = payload.config?.configurable?.graphSettings?.graphType;
      if (!graphType) {
        throw new Error(
          "GraphType is required in payload.config.configurable.graphSettings"
        );
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
        // Fallback: create instance manually
        versionedBuilder = await moduleRef.create(resolution.builderClass);
      }

      // IMPORTANT: Call preparePayload BEFORE buildGraph to set checkpoint_ns and checkpoint_id
      const preparedPayload = await versionedBuilder.preparePayload(payload);
      return versionedBuilder.buildGraph(preparedPayload);
    }

    async preparePayload(payload: IGraphRequestPayload): Promise<any> {
      const graphType = payload.config?.configurable?.graphSettings?.graphType;
      if (!graphType) {
        throw new Error(
          "GraphType is required in payload.config.configurable.graphSettings"
        );
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
        config: {
          ...payload.config,
          configurable: {
            ...payload.config.configurable,
            graphSettings: {
              ...payload.config.configurable.graphSettings,
              graphType: resolution.fullGraphType,
            },
          },
        },
      };

      return versionedBuilder.preparePayload(updatedPayload);
    }
  }

  // Set meaningful name for the class
  Object.defineProperty(VersionRouter, "name", { value: className });

  return VersionRouter;
}

/**
 * Build the CHECKPOINTER provider(s) based on the supplied options.
 *
 * Selection order:
 *   1. postgres  — uses @langchain/langgraph-checkpoint-postgres
 *   2. mongodb   — uses @langchain/langgraph-checkpoint-mongodb
 *   3. (none)    — falls back to MemorySaver (no persistence, warns at startup)
 */
function buildCheckpointerProviders(
  options: UniversalGraphModuleOptions
): Provider[] {
  const logger = new Logger("UniversalGraphModule");

  // ── Postgres ──────────────────────────────────────────────────────────────
  if (options.postgres !== undefined) {
    return [
      {
        provide: "CHECKPOINTER",
        useFactory: async () => {
          const { PostgresSaver } = await import(
            // Dynamic import keeps the package optional at build time
            "@langchain/langgraph-checkpoint-postgres" as string
          );

          const connString =
            options.postgres!.connectionString ?? process.env.DATABASE_URL;

          if (!connString) {
            throw new Error(
              "[UniversalGraphModule] Postgres checkpointer: provide postgres.connectionString " +
                "or set the DATABASE_URL environment variable."
            );
          }

          logger.log(
            `Checkpointer: PostgreSQL (${connString.replace(/:[^:@]+@/, ":***@")})`
          );

          const saver = PostgresSaver.fromConnString(connString, {
            ...(options.postgres!.schema
              ? { schema: options.postgres!.schema }
              : {}),
          });

          // Creates checkpoint tables the first time (idempotent)
          await saver.setup();
          return saver;
        },
      },
    ];
  }

  // ── MongoDB ───────────────────────────────────────────────────────────────
  if (options.mongodb !== undefined) {
    return [
      {
        provide: "MONGO_CONNECTION",
        useFactory: async (
          configService: ConfigService
        ): Promise<Connection> => {
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
              "[UniversalGraphModule] MongoDB checkpointer: provide mongodb.uri " +
                "or set the MONGODB_URI environment variable."
            );
          }

          logger.log(`Checkpointer: MongoDB (${mongoUri.substring(0, 50)}...)`);
          await mongoose.connect(mongoUri, { dbName });
          return mongoose.connection;
        },
        inject: [ConfigService],
      },
      {
        provide: "CHECKPOINTER",
        useFactory: async (
          connection: Connection,
          configService: ConfigService
        ) => {
          const dbName =
            options.mongodb?.dbName ||
            configService.get<string>("MONGO_DB_NAME") ||
            process.env.MONGO_DB_NAME;

          const mongoClient = createMongoClientAdapter(connection.getClient());
          return new MongoDBSaver({
            client: mongoClient,
            dbName,
            checkpointCollectionName:
              options.mongodb?.checkpointCollectionName ?? "checkpoints",
            checkpointWritesCollectionName:
              options.mongodb?.checkpointWritesCollectionName ??
              "checkpoint_writes",
          });
        },
        inject: ["MONGO_CONNECTION", ConfigService],
      },
    ];
  }

  // ── In-memory fallback ────────────────────────────────────────────────────
  return [
    {
      provide: "CHECKPOINTER",
      useFactory: async () => {
        const { MemorySaver } = await import("@langchain/langgraph");
        logger.warn(
          "Checkpointer: MemorySaver (in-process, no persistence). " +
            "Configure postgres or mongodb in UniversalGraphModule.forRoot() for production."
        );
        return new MemorySaver();
      },
    },
  ];
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
      // Callback infrastructure — Redis or in-memory fallback
      {
        provide: "REDIS_CLIENT",
        useFactory: () => {
          const redisUrl = options.redis?.url ?? process.env.REDIS_URL;
          if (redisUrl) {
            const Redis = require("ioredis");
            const logger = new Logger("UniversalGraphModule");
            logger.log(
              `Callbacks: Redis (${redisUrl.replace(/:[^:@]+@/, ":***@")})`
            );
            return new Redis(redisUrl);
          }
          // In-memory fallback — no external dependencies required
          const IORedisMock = require("ioredis-mock");
          new Logger("UniversalGraphModule").warn(
            "Callbacks: in-memory store (single-instance only). " +
              "Set redis.url or REDIS_URL for production."
          );
          return new IORedisMock();
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
      // ── Checkpointer ────────────────────────────────────────────────────
      // Priority: postgres > mongodb > memory (in-process, no persistence)
      ...buildCheckpointerProviders(options),
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
          const initLogger = new Logger("UniversalGraphModule");
          initLogger.debug(
            `Initializing versioning for ${configs?.length || 0} graph type(s)`
          );

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
              initLogger.debug(
                `Registered VersionRouter for ${config.baseGraphType}`
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

                async preparePayload(payload: any): Promise<any> {
                  throw new Error(
                    "ModuleRef not available - cannot prepare config"
                  );
                }
              }

              const simpleRouter = new SimpleVersionRouter();
              initLogger.warn(
                `Registered SimpleRouter for ${config.baseGraphType} (no ModuleRef)`
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
        "CHECKPOINTER",
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

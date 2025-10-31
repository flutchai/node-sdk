import { NestFactory } from "@nestjs/core";
import { Logger, ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import * as net from "net";
import * as fs from "fs";
import * as path from "path";

/**
 * Check port availability
 */
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

/**
 * Find available port starting from the given one
 */
async function findAvailablePort(startPort: number): Promise<number> {
  let port = startPort;
  while (port < startPort + 100) {
    // Check up to 100 ports
    if (await isPortAvailable(port)) {
      return port;
    }
    port++;
  }
  throw new Error(
    `No available ports found in range ${startPort}-${startPort + 99}`
  );
}

/**
 * Automatic service discovery registration
 * NOTE: This feature requires @amelie/graph-service-registry package
 * which is an optional dependency. Commented out for standalone SDK usage.
 * Uncomment and install @amelie/graph-service-registry if needed.
 */
/*
async function registerWithServiceDiscovery(
  AppModule: any,
  port: number,
  logger: Logger,
  app?: any
): Promise<void> {
  try {
    // Dynamic import to avoid circular dependencies
    const { FileBasedDiscovery } = await import(
      "@amelie/graph-service-registry/dist/service-discovery/file-based.discovery"
    );

    const discovery = new FileBasedDiscovery();

    // Derive service name from module name
    const serviceName = AppModule.name.replace("Module", "").toLowerCase();

    // Extract supported graph types from registered builders
    let graphTypes: string[] = [];
    try {
      if (app) {
        // Get BuilderRegistry from application
        const { BuilderRegistryService } = await import(
          "./core/builder-registry.service"
        );
        const builderRegistry = app.get(BuilderRegistryService, {
          strict: false,
        });
        logger.debug(
          `BuilderRegistryService found in DI: ${!!builderRegistry}`
        );

        if (builderRegistry) {
          const builders = builderRegistry.getBuilders();
          logger.debug(`Found ${builders.length} builders in registry`);
          const baseGraphTypes = builders.map(builder => builder.graphType);
          logger.debug(`Base graph types: [${baseGraphTypes.join(", ")}]`);

          // Try to get versioned types from VersionedGraphService
          try {
            logger.debug("Attempting to import VersionedGraphService...");
            const { VersionedGraphService } = await import(
              "./versioning/versioned-graph.service"
            );
            logger.debug("VersionedGraphService imported successfully");

            const versionedService = app.get(VersionedGraphService, {
              strict: false,
            });
            logger.debug(
              `VersionedGraphService found in DI: ${!!versionedService}`
            );

            if (versionedService) {
              // Collect all versions for each base type
              const allVersionedTypes: string[] = [];
              for (const baseType of baseGraphTypes) {
                logger.debug(`Getting versions for base type: ${baseType}`);
                const versions =
                  versionedService.getAvailableVersions(baseType);
                logger.debug(
                  `Found ${versions.length} versions for ${baseType}: [${versions.join(", ")}]`
                );

                if (versions.length > 0) {
                  // Add base type and all its versions
                  allVersionedTypes.push(baseType);
                  versions.forEach(version => {
                    allVersionedTypes.push(`${baseType}::${version}`);
                  });
                } else {
                  // If no versions, add only base type
                  allVersionedTypes.push(baseType);
                }
              }
              graphTypes = allVersionedTypes;
              logger.debug(
                `Found ${baseGraphTypes.length} base types with ${graphTypes.length} total versioned types: ${graphTypes.join(", ")}`
              );
            } else {
              // Fallback to base types if VersionedGraphService is not available
              graphTypes = baseGraphTypes;
              logger.debug(
                `VersionedGraphService not found in DI container, using base types: ${graphTypes.join(", ")}`
              );
            }
          } catch (error) {
            // Fallback to base types if error getting versions
            graphTypes = baseGraphTypes;
            logger.debug(
              `Failed to get versioned types, using base types: ${error.message}`
            );
            logger.debug(`Stack trace: ${error.stack}`);
          }
        }
      }
    } catch (error) {
      logger.debug(`Failed to get graph types from builders: ${error.message}`);
    }

    // Fallback to service name if no builders found
    if (graphTypes.length === 0) {
      logger.debug("No builders found, using service name as graph type");
      graphTypes = [serviceName];
    }

    await discovery.registerService(
      serviceName,
      "localhost",
      port,
      {
        graphTypes,
        environment: "development",
        startTime: new Date().toISOString(),
        version: process.env.npm_package_version || "1.0.0",
      },
      graphTypes
    );

    logger.log(
      `📡 Service registered with discovery: ${serviceName} (types: ${graphTypes.join(", ")})`
    );
  } catch (error) {
    logger.warn(`Failed to register with service discovery: ${error.message}`);
  }
}
*/

/**
 * Bootstrap function for graph microservices
 */
export async function bootstrap(
  AppModule: any,
  options: { port?: number; globalPrefix?: string } = {}
) {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger("Bootstrap");

  // Configuration
  const requestedPort =
    options.port || parseInt(process.env.PORT || "3000", 10);
  const port = await findAvailablePort(requestedPort);
  const globalPrefix = options.globalPrefix;

  if (port !== requestedPort) {
    logger.warn(`Port ${requestedPort} is busy, using port ${port} instead`);
  }

  // Global prefix (only if specified)
  if (globalPrefix) {
    app.setGlobalPrefix(globalPrefix);
  }

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    })
  );

  // CORS
  app.enableCors({
    origin: true,
    credentials: true,
  });

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle("Graph Service API")
    .setDescription("API for graph service microservice")
    .setVersion("1.0")
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, document);

  // Start the server
  await app.listen(port);

  const baseUrl = globalPrefix
    ? `http://localhost:${port}/${globalPrefix}`
    : `http://localhost:${port}`;
  logger.log(`🚀 Graph service is running on: ${baseUrl}`);
  logger.log(`📚 API Documentation: http://localhost:${port}/api/docs`);

  // Service Discovery Registration (only in development)
  if (process.env.NODE_ENV !== "production") {
    // Disabled: requires optional @amelie/graph-service-registry dependency
    // await registerWithServiceDiscovery(AppModule, port, logger, app);
  }

  return app;
}

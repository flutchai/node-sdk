import { Injectable, Logger } from "@nestjs/common";
import { ServiceDiscoveryProvider } from "./service-discovery.provider";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

interface ServiceRegistration {
  name: string;
  address: string;
  port: number;
  metadata: Record<string, any>;
  pid: number;
  timestamp: number;
  graphTypes: string[];
}

/**
 * File-based service discovery for local development
 * Services are registered in ~/.flutch/services/
 */
@Injectable()
export class FileBasedDiscovery implements ServiceDiscoveryProvider {
  private readonly logger = new Logger(FileBasedDiscovery.name);
  private readonly servicesDir: string;

  constructor() {
    this.servicesDir = path.join(os.homedir(), ".flutch", "services");
    this.ensureServicesDirectory();
    this.cleanupStaleServices();
  }

  /**
   * Register service
   */
  async registerService(
    name: string,
    address: string,
    port: number,
    metadata: Record<string, any>,
    graphTypes: string[] = []
  ): Promise<void> {
    const registration: ServiceRegistration = {
      name,
      address,
      port,
      metadata,
      pid: process.pid,
      timestamp: Date.now(),
      graphTypes,
    };

    const serviceFile = path.join(
      this.servicesDir,
      `${name}-${process.pid}.json`
    );

    try {
      await fs.promises.writeFile(
        serviceFile,
        JSON.stringify(registration, null, 2)
      );

      this.logger.log(`Registered service: ${name} at ${address}:${port}`);

      // Automatic cleanup on process exit
      process.on("exit", () => this.unregisterService(name));
      process.on("SIGINT", () => {
        this.unregisterService(name);
        process.exit(0);
      });
      process.on("SIGTERM", () => {
        this.unregisterService(name);
        process.exit(0);
      });
    } catch (error) {
      this.logger.error(`Failed to register service ${name}: ${error.message}`);
    }
  }

  /**
   * Unregister service
   */
  async unregisterService(name: string): Promise<void> {
    const serviceFile = path.join(
      this.servicesDir,
      `${name}-${process.pid}.json`
    );

    try {
      if (fs.existsSync(serviceFile)) {
        await fs.promises.unlink(serviceFile);
        this.logger.log(`Unregistered service: ${name}`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to unregister service ${name}: ${error.message}`
      );
    }
  }

  /**
   * Get list of services by graph type
   */
  async getServices(graphType: string): Promise<
    Array<{
      name: string;
      address: string;
      port: number;
      metadata: Record<string, any>;
    }>
  > {
    try {
      const files = await fs.promises.readdir(this.servicesDir);
      const services: Array<{
        name: string;
        address: string;
        port: number;
        metadata: Record<string, any>;
      }> = [];

      for (const file of files) {
        if (!file.endsWith(".json")) continue;

        try {
          const serviceFile = path.join(this.servicesDir, file);
          const content = await fs.promises.readFile(serviceFile, "utf-8");
          const registration: ServiceRegistration = JSON.parse(content);

          // Check if process is still alive
          if (!this.isProcessAlive(registration.pid)) {
            await fs.promises.unlink(serviceFile);
            continue;
          }

          // Check if service supports required graph type
          if (
            registration.graphTypes.includes(graphType) ||
            registration.metadata.graphTypes?.includes(graphType)
          ) {
            services.push({
              name: registration.name,
              address: registration.address,
              port: registration.port,
              metadata: registration.metadata,
            });
          }
        } catch (error) {
          this.logger.warn(
            `Failed to parse service file ${file}: ${error.message}`
          );
        }
      }

      return services;
    } catch (error) {
      this.logger.error(`Failed to get services: ${error.message}`);
      return [];
    }
  }

  /**
   * Find service by name
   */
  async findServiceByName(serviceName: string): Promise<{
    name: string;
    address: string;
    port: number;
    metadata: Record<string, any>;
  } | null> {
    try {
      const files = await fs.promises.readdir(this.servicesDir);

      for (const file of files) {
        if (!file.endsWith(".json")) continue;

        try {
          const serviceFile = path.join(this.servicesDir, file);
          const content = await fs.promises.readFile(serviceFile, "utf-8");
          const registration: ServiceRegistration = JSON.parse(content);

          if (
            registration.name === serviceName &&
            this.isProcessAlive(registration.pid)
          ) {
            return {
              name: registration.name,
              address: registration.address,
              port: registration.port,
              metadata: registration.metadata,
            };
          }
        } catch (error) {
          this.logger.warn(
            `Failed to parse service file ${file}: ${error.message}`
          );
        }
      }

      return null;
    } catch (error) {
      this.logger.error(
        `Failed to find service ${serviceName}: ${error.message}`
      );
      return null;
    }
  }

  /**
   * Ensure services directory exists
   */
  private ensureServicesDirectory(): void {
    try {
      const amelieDir = path.join(os.homedir(), ".flutch");
      if (!fs.existsSync(amelieDir)) {
        fs.mkdirSync(amelieDir, { recursive: true });
      }

      if (!fs.existsSync(this.servicesDir)) {
        fs.mkdirSync(this.servicesDir, { recursive: true });
      }
    } catch (error) {
      this.logger.error(
        `Failed to create services directory: ${error.message}`
      );
    }
  }

  /**
   * Cleanup stale services
   */
  private async cleanupStaleServices(): Promise<void> {
    try {
      const files = await fs.promises.readdir(this.servicesDir);

      for (const file of files) {
        if (!file.endsWith(".json")) continue;

        try {
          const serviceFile = path.join(this.servicesDir, file);
          const content = await fs.promises.readFile(serviceFile, "utf-8");
          const registration: ServiceRegistration = JSON.parse(content);

          // Remove dead process entries
          if (!this.isProcessAlive(registration.pid)) {
            await fs.promises.unlink(serviceFile);
            this.logger.debug(`Cleaned up stale service: ${registration.name}`);
          }
        } catch (error) {
          // Remove corrupted files
          try {
            await fs.promises.unlink(path.join(this.servicesDir, file));
          } catch {}
        }
      }
    } catch (error) {
      this.logger.error(`Failed to cleanup stale services: ${error.message}`);
    }
  }

  /**
   * Check if process is still alive
   */
  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return false;
    }
  }
}

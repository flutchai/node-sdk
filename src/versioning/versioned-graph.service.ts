// packages/sdk/src/versioning/versioned-graph.service.ts
import { Injectable, Logger } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { GraphTypeUtils } from "../utils/graph-type.utils";
import { AbstractGraphBuilder } from "../core/abstract-graph.builder";
import {
  VersioningConfig,
  VersionRoute,
  VersionResolution,
  VersionResolutionOptions,
} from "./versioning.types";

/**
 * Service for managing graph versions
 * Abstracts versioning logic to the service-mesh level
 */
@Injectable()
export class VersionedGraphService {
  private readonly logger = new Logger(VersionedGraphService.name);
  private readonly versionConfigs = new Map<string, VersioningConfig>();

  constructor() {
    // Initialization now happens through UniversalGraphModule
    // ModuleRef will be provided when needed via method parameters
  }

  /**
   * Register versioning configuration
   */
  registerVersioning(config: VersioningConfig): void {
    this.versionConfigs.set(config.baseGraphType, config);
    this.logger.log(
      `Registered versioning for ${config.baseGraphType} with ${config.versions.length} versions`
    );
  }

  /**
   * Resolve graph version
   */
  async resolveVersion(
    graphType: string,
    options: VersionResolutionOptions = {}
  ): Promise<VersionResolution> {
    const parsed = GraphTypeUtils.parse(graphType);
    const baseType = GraphTypeUtils.getBaseType(graphType);
    const requestedVersion =
      GraphTypeUtils.getVersion(graphType) || options.requestedVersion;

    const config = this.versionConfigs.get(baseType);
    if (!config) {
      throw new Error(`No versioning configuration found for ${baseType}`);
    }

    // Find suitable version
    const route = this.findBestVersionRoute(config, requestedVersion, options);
    if (!route) {
      throw new Error(
        `No compatible version found for ${graphType} with options: ${JSON.stringify(options)}`
      );
    }

    const fullGraphType = GraphTypeUtils.build(
      parsed.companyId,
      parsed.name,
      route.version
    );

    return {
      version: route.version,
      builderClass: route.builderClass,
      fullGraphType,
    };
  }

  /**
   * Create builder for specified version
   */
  async createVersionedBuilder(
    graphType: string,
    moduleRef?: ModuleRef,
    options: VersionResolutionOptions = {}
  ): Promise<AbstractGraphBuilder<any>> {
    const resolution = await this.resolveVersion(graphType, options);

    try {
      if (!moduleRef) {
        throw new Error(
          "ModuleRef is not available - falling back to direct instantiation"
        );
      }
      const builder = await moduleRef.create(resolution.builderClass);
      this.logger.debug(
        `Created versioned builder for ${resolution.fullGraphType}`
      );
      return builder;
    } catch (error) {
      this.logger.error(
        `Failed to create builder for ${resolution.fullGraphType}: ${error.message}`
      );
      throw new Error(`Failed to create versioned builder: ${error.message}`);
    }
  }

  /**
   * Get all available versions for a graph
   */
  getAvailableVersions(baseGraphType: string): string[] {
    const config = this.versionConfigs.get(baseGraphType);
    if (!config) {
      return [];
    }

    return config.versions
      .map(route => route.version)
      .sort((a, b) => GraphTypeUtils.compareVersions(b, a)); // Sort in descending order
  }

  /**
   * Check version support
   */
  isVersionSupported(
    graphType: string,
    options: VersionResolutionOptions = {}
  ): boolean {
    try {
      const baseType = GraphTypeUtils.getBaseType(graphType);
      const requestedVersion = GraphTypeUtils.getVersion(graphType);
      const config = this.versionConfigs.get(baseType);

      if (!config) {
        return false;
      }

      const route = this.findBestVersionRoute(
        config,
        requestedVersion,
        options
      );
      return route !== null;
    } catch {
      return false;
    }
  }

  /**
   * Find best version
   */
  private findBestVersionRoute(
    config: VersioningConfig,
    requestedVersion?: string,
    options: VersionResolutionOptions = {}
  ): VersionRoute | null {
    const { strict = false } = options;
    let candidates = [...config.versions];

    // If a specific version is requested
    if (requestedVersion) {
      // Exact match
      const exactMatch = candidates.find(
        route => route.version === requestedVersion
      );
      if (exactMatch) {
        return exactMatch;
      }

      // In strict mode, don't search for alternatives
      if (strict) {
        return null;
      }

      // Find compatible version (semantic versioning)
      const compatibleVersions = candidates.filter(route =>
        this.isVersionCompatible(requestedVersion, route.version)
      );

      if (compatibleVersions.length > 0) {
        // Return the newest compatible version
        return compatibleVersions.sort((a, b) =>
          GraphTypeUtils.compareVersions(b.version, a.version)
        )[0];
      }
    }

    // Return default version
    const defaultRoute = candidates.find(route => route.isDefault);
    if (defaultRoute) {
      return defaultRoute;
    }

    // If there's no explicit default version, use strategy
    if (
      config.defaultVersionStrategy === "latest" ||
      !config.defaultVersionStrategy
    ) {
      const sortedVersions = candidates.sort((a, b) =>
        GraphTypeUtils.compareVersions(b.version, a.version)
      );
      return sortedVersions[0] || null;
    }

    return null;
  }

  /**
   * Check version compatibility (simplified semantics)
   */
  private isVersionCompatible(requested: string, available: string): boolean {
    try {
      const requestedParts = requested.split(".").map(Number);
      const availableParts = available.split(".").map(Number);

      // Major version must match
      if (requestedParts[0] !== availableParts[0]) {
        return false;
      }

      // Available version must be >= requested
      return GraphTypeUtils.compareVersions(available, requested) >= 0;
    } catch {
      return false;
    }
  }

  /**
   * Get versioning configuration information
   */
  getVersioningInfo(baseGraphType: string): VersioningConfig | null {
    return this.versionConfigs.get(baseGraphType) || null;
  }
}

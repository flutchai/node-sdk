// packages/sdk/src/versioning/versioning.types.ts
import { Type } from "@nestjs/common";
import { AbstractGraphBuilder } from "../core/abstract-graph.builder";

/**
 * Version configuration for a graph
 */
export interface VersionRoute {
  /** Version (e.g., "1.0.0", "1.1.0") */
  version: string;
  /** Builder class for this version */
  builderClass: Type<AbstractGraphBuilder<any>>;
  /** Whether this is the default version */
  isDefault?: boolean;
}

/**
 * Versioning configuration for a graph
 */
export interface VersioningConfig {
  /** Base graph type (e.g., "global.simple") */
  baseGraphType: string;
  /** Version routes */
  versions: VersionRoute[];
  /** Default version selection strategy */
  defaultVersionStrategy?: "latest" | "explicit";
}

/**
 * Version resolution result
 */
export interface VersionResolution {
  /** Found version */
  version: string;
  /** Builder class */
  builderClass: Type<AbstractGraphBuilder<any>>;
  /** Full graph type with version */
  fullGraphType: string;
}

/**
 * Options for version resolution
 */
export interface VersionResolutionOptions {
  /** Requested version (may be imprecise) */
  requestedVersion?: string;
  /** Strict mode (do not allow fallback) */
  strict?: boolean;
}

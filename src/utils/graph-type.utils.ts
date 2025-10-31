/**
 * Utilities for working with versioned graph types
 * Format: "company.name::version"
 * Examples:
 * - "global.simple::1.2.0"
 * - "company-123.customRag::2.1.0-beta"
 * - "global.simple" (without version)
 * - "simple" (legacy format)
 */
export class GraphTypeUtils {
  /**
   * Parse full graph type
   * @param fullType - full graph type
   * @returns object with type components
   */
  static parse(fullType: string): {
    companyId: string;
    name: string;
    version?: string;
  } {
    // Check for version presence
    if (fullType.includes("::")) {
      const [baseType, version] = fullType.split("::");
      const [companyId, name] = baseType.split(".");
      return { companyId, name, version };
    }

    // Without version: "global.simple" or legacy format "simple"
    const parts = fullType.split(".");

    // Legacy format: "simple" → "global.simple"
    if (parts.length === 1) {
      return { companyId: "global", name: parts[0] };
    }

    // Format without version: "global.simple"
    return { companyId: parts[0], name: parts[1] };
  }

  /**
   * Build full type from components
   * @param companyId - company ID
   * @param name - graph name
   * @param version - version (optional)
   * @returns full graph type
   */
  static build(companyId: string, name: string, version?: string): string {
    const base = `${companyId}.${name}`;
    return version ? `${base}::${version}` : base;
  }

  /**
   * Normalize graph type for backward compatibility
   * @param graphType - graph type in any format
   * @returns normalized type
   */
  static normalize(graphType: string): string {
    const { companyId, name, version } = this.parse(graphType);
    return this.build(companyId, name, version);
  }

  /**
   * Get base type without version
   * @param graphType - full graph type
   * @returns base type
   */
  static getBaseType(graphType: string): string {
    if (graphType.includes("::")) {
      return graphType.split("::")[0];
    }
    // Normalize legacy format
    const { companyId, name } = this.parse(graphType);
    return `${companyId}.${name}`;
  }

  /**
   * Extract version from graph type
   * @param graphType - full graph type
   * @returns version or undefined
   */
  static getVersion(graphType: string): string | undefined {
    return graphType.includes("::") ? graphType.split("::")[1] : undefined;
  }

  /**
   * Validate version (basic semver check)
   * @param version - version to check
   * @returns true if version is valid
   */
  static isValidVersion(version: string): boolean {
    // Basic semver pattern check
    const semverRegex = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/;
    return semverRegex.test(version);
  }

  /**
   * Check if type is system (global)
   * @param graphType - graph type
   * @returns true if graph is system
   */
  static isSystemGraph(graphType: string): boolean {
    const { companyId } = this.parse(graphType);
    return companyId === "global";
  }

  /**
   * Compare versions (simple comparison for sorting)
   * @param a - first version
   * @param b - second version
   * @returns -1, 0, 1 for sorting
   */
  static compareVersions(a: string, b: string): number {
    const parseVersion = (v: string) => {
      const [main, prerelease] = v.split("-");
      const [major, minor, patch] = main.split(".").map(Number);
      return { major, minor, patch, prerelease };
    };

    const versionA = parseVersion(a);
    const versionB = parseVersion(b);

    // Compare major
    if (versionA.major !== versionB.major) {
      return versionA.major - versionB.major;
    }

    // Compare minor
    if (versionA.minor !== versionB.minor) {
      return versionA.minor - versionB.minor;
    }

    // Compare patch
    if (versionA.patch !== versionB.patch) {
      return versionA.patch - versionB.patch;
    }

    // Compare prerelease
    if (versionA.prerelease && !versionB.prerelease) return -1;
    if (!versionA.prerelease && versionB.prerelease) return 1;
    if (versionA.prerelease && versionB.prerelease) {
      return versionA.prerelease.localeCompare(versionB.prerelease);
    }

    return 0;
  }
}

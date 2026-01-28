/**
 * Pure business logic for AbstractGraphBuilder — no I/O, no DI, no NestJS.
 * Easily testable without mocks.
 */

/**
 * Generate a full graph type string: "companySlug.name::version"
 */
export function generateFullGraphType(
  companySlug: string,
  name: string,
  version: string
): string {
  return `${companySlug}.${name}::${version}`;
}

/**
 * Validate that a version string is valid semver (X.Y.Z).
 */
export function isValidSemver(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}

/**
 * Parse a callback token in format "cb_{graphName}_{handler}_{encodedParams}".
 * Returns null if the format is invalid.
 */
export function parseCallbackToken(
  token: string
): { graphType: string; handler: string } | null {
  const parts = token.split("_");

  if (parts.length < 4 || parts[0] !== "cb") {
    return null;
  }

  const graphName = parts[1];
  const handler = parts[2];

  // TODO: Add default version or extract from token
  const graphType = `${graphName}::1.0.0`;

  return { graphType, handler };
}

/**
 * Decode base64url-encoded callback params from a token.
 * Returns empty object on failure.
 */
export function decodeCallbackParams(token: string): Record<string, any> {
  const parts = token.split("_");

  if (parts.length < 4) {
    return {};
  }

  try {
    const encodedParams = parts.slice(3).join("_");
    const decodedParams = Buffer.from(encodedParams, "base64url").toString(
      "utf8"
    );
    return JSON.parse(decodedParams);
  } catch {
    return {};
  }
}

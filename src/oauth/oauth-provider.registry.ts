import { OAuthProviderConfig } from "./oauth-token.interfaces";

/**
 * Static OAuth provider definition.
 * Loaded from a local oauth-providers.json config file per deployment.
 */
export interface OAuthProviderDef {
  name: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientIdEnvVar: string;
  clientSecretEnvVar: string;
}

/**
 * In-memory registry. Populated by loadOAuthProviders() at app startup.
 */
let registry: Record<string, OAuthProviderDef> = {};

/**
 * Load provider definitions from a config object (parsed JSON).
 * Call once at app startup.
 */
export function loadOAuthProviders(
  providers: Record<string, OAuthProviderDef>
): void {
  registry = { ...providers };
}

/**
 * Get a provider definition by name.
 * Throws if provider is not found.
 */
export function getOAuthProvider(provider: string): OAuthProviderDef {
  const def = registry[provider];
  if (!def) {
    throw new Error(`Unknown OAuth provider: ${provider}`);
  }
  return def;
}

/**
 * Get all loaded provider names.
 */
export function getOAuthProviderNames(): string[] {
  return Object.keys(registry);
}

/**
 * Resolve a provider definition into a runtime OAuthProviderConfig
 * by reading client ID/secret from environment variables.
 */
export function resolveOAuthProviderConfig(
  provider: string
): OAuthProviderConfig {
  const def = getOAuthProvider(provider);

  const clientId = process.env[def.clientIdEnvVar];
  const clientSecret = process.env[def.clientSecretEnvVar];

  if (!clientId) {
    throw new Error(`Missing env var: ${def.clientIdEnvVar}`);
  }
  if (!clientSecret) {
    throw new Error(`Missing env var: ${def.clientSecretEnvVar}`);
  }

  return {
    provider: def.name,
    tokenUrl: def.tokenUrl,
    clientId,
    clientSecret,
  };
}

/**
 * Build the OAuth authorization URL for a provider.
 */
export function buildOAuthAuthorizationUrl(
  provider: string,
  params: {
    redirectUri: string;
    state: string;
  }
): string {
  const def = getOAuthProvider(provider);

  const clientId = process.env[def.clientIdEnvVar];
  if (!clientId) {
    throw new Error(`Missing env var: ${def.clientIdEnvVar}`);
  }

  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: params.redirectUri,
    response_type: "code",
    state: params.state,
  });

  if (def.scopes.length > 0) {
    query.set("scope", def.scopes.join(" "));
  }

  return `${def.authorizationUrl}?${query.toString()}`;
}

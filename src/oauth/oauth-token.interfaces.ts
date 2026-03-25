/**
 * OAuth 2.0 Token Management interfaces
 *
 * Generic token lifecycle management for any OAuth 2.0 provider
 * (Jobber, HubSpot, Salesforce, etc.)
 */

/**
 * Decrypted OAuth tokens
 */
export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Token expiration timestamp in unix milliseconds */
  expiresAt: number;
}

/**
 * OAuth provider configuration for token refresh
 */
export interface OAuthProviderConfig {
  /** Unique provider identifier (e.g. "jobber", "hubspot") */
  provider: string;
  /** Token endpoint URL for refresh requests */
  tokenUrl: string;
  /** OAuth client ID */
  clientId: string;
  /** OAuth client secret */
  clientSecret: string;
}

/**
 * Pluggable token store interface.
 * Stores and retrieves encrypted token strings.
 */
export interface IOAuthTokenStore {
  /** Get encrypted token data for a provider */
  get(provider: string): Promise<string | null>;
  /** Save encrypted token data for a provider */
  save(provider: string, encrypted: string): Promise<void>;
  /** Delete token data for a provider */
  delete(provider: string): Promise<void>;
}

/**
 * OAuthTokenManager constructor options
 */
export interface OAuthTokenManagerOptions {
  /** Persistent token store (file or database) */
  store: IOAuthTokenStore;
  /** AES-256-CBC encryption key (32 bytes as UTF-8 string) */
  encryptionKey: string;
}

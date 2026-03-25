/**
 * Generic OAuth 2.0 Token Manager
 *
 * Handles token lifecycle for any OAuth 2.0 provider:
 * - In-memory caching (avoids store lookups on every call)
 * - Persistent encrypted storage (survives restarts)
 * - Automatic token refresh when expired
 * - Refresh token rotation support
 *
 * @example
 * ```typescript
 * // OSS — file-based storage
 * const manager = new OAuthTokenManager({
 *   store: new FileTokenStore('/data/oauth-tokens.json'),
 *   encryptionKey: process.env.OAUTH_ENCRYPTION_KEY,
 * });
 *
 * // Cloud — MongoDB storage
 * const manager = new OAuthTokenManager({
 *   store: new MongoTokenStore(db),
 *   encryptionKey: process.env.OAUTH_ENCRYPTION_KEY,
 * });
 *
 * // Get a fresh access token (auto-refreshes if expired)
 * const token = await manager.getAccessToken({
 *   provider: 'jobber',
 *   tokenUrl: 'https://api.getjobber.com/api/oauth/token',
 *   clientId: process.env.JOBBER_CLIENT_ID,
 *   clientSecret: process.env.JOBBER_CLIENT_SECRET,
 * });
 * ```
 */
import axios from "axios";
import { encryptTokens, decryptTokens } from "./oauth-crypto.utils";
import type {
  IOAuthTokenStore,
  OAuthProviderConfig,
  OAuthTokenManagerOptions,
  OAuthTokens,
} from "./oauth-token.interfaces";

/** Buffer time before expiry to trigger proactive refresh (60 seconds) */
const EXPIRY_BUFFER_MS = 60_000;

export class OAuthTokenManager {
  private readonly store: IOAuthTokenStore;
  private readonly encryptionKey: string;
  private readonly cache = new Map<
    string,
    { token: string; expiresAt: number }
  >();

  constructor(options: OAuthTokenManagerOptions) {
    if (!options.encryptionKey || options.encryptionKey.length < 32) {
      throw new Error(
        "OAUTH_ENCRYPTION_KEY must be at least 32 characters for AES-256-CBC",
      );
    }
    this.store = options.store;
    this.encryptionKey = options.encryptionKey;
  }

  /**
   * Get a fresh access token for the given provider.
   * Returns from cache → store → refresh flow (in that order).
   */
  async getAccessToken(config: OAuthProviderConfig): Promise<string> {
    // 1. In-memory cache hit
    const cached = this.cache.get(config.provider);
    if (cached && cached.expiresAt > Date.now() + EXPIRY_BUFFER_MS) {
      return cached.token;
    }

    // 2. Load from persistent store
    const encrypted = await this.store.get(config.provider);
    if (!encrypted) {
      throw new Error(
        `No OAuth tokens found for "${config.provider}". ` +
          `Complete the OAuth consent flow first and call saveTokens().`,
      );
    }

    const tokens = decryptTokens(encrypted, this.encryptionKey);

    // 3. Still valid? Cache and return
    if (tokens.expiresAt > Date.now() + EXPIRY_BUFFER_MS) {
      this.setCache(config.provider, tokens.accessToken, tokens.expiresAt);
      return tokens.accessToken;
    }

    // 4. Expired — refresh
    const refreshed = await this.refreshAccessToken(config, tokens.refreshToken);

    // 5. Persist new tokens
    await this.persistTokens(config.provider, refreshed);

    return refreshed.accessToken;
  }

  /**
   * Store tokens after the initial OAuth consent flow.
   * Call this once after the user completes the OAuth redirect.
   */
  async saveTokens(provider: string, tokens: OAuthTokens): Promise<void> {
    await this.persistTokens(provider, tokens);
  }

  /**
   * Remove all tokens for a provider.
   */
  async revokeTokens(provider: string): Promise<void> {
    await this.store.delete(provider);
    this.cache.delete(provider);
  }

  /**
   * Check if tokens exist for a provider (without decrypting).
   */
  async hasTokens(provider: string): Promise<boolean> {
    const encrypted = await this.store.get(provider);
    return encrypted !== null;
  }

  private async refreshAccessToken(
    config: OAuthProviderConfig,
    refreshToken: string,
  ): Promise<OAuthTokens> {
    try {
      const response = await axios.post(
        config.tokenUrl,
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: config.clientId,
          client_secret: config.clientSecret,
          refresh_token: refreshToken,
        }).toString(),
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: 10_000,
        },
      );

      const data = response.data;
      return {
        accessToken: data.access_token,
        // Some providers rotate refresh tokens; keep the old one if not rotated
        refreshToken: data.refresh_token || refreshToken,
        expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
      };
    } catch (error: any) {
      const status = error?.response?.status;
      const body = error?.response?.data;
      throw new Error(
        `OAuth refresh failed for "${config.provider}": ` +
          `${status || "network error"} ${JSON.stringify(body) || error.message}`,
      );
    }
  }

  private async persistTokens(
    provider: string,
    tokens: OAuthTokens,
  ): Promise<void> {
    const encrypted = encryptTokens(tokens, this.encryptionKey);
    await this.store.save(provider, encrypted);
    this.setCache(provider, tokens.accessToken, tokens.expiresAt);
  }

  private setCache(
    provider: string,
    token: string,
    expiresAt: number,
  ): void {
    this.cache.set(provider, { token, expiresAt });
  }
}

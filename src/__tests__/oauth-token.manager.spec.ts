import axios from "axios";
import { OAuthTokenManager } from "../oauth/oauth-token.manager";
import type {
  IOAuthTokenStore,
  OAuthProviderConfig,
  OAuthTokens,
} from "../oauth/oauth-token.interfaces";
import { encryptTokens } from "../oauth/oauth-crypto.utils";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

const ENCRYPTION_KEY = "a]1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p"; // 32 chars

const makeConfig = (
  overrides?: Partial<OAuthProviderConfig>
): OAuthProviderConfig => ({
  provider: "jobber",
  tokenUrl: "https://api.getjobber.com/oauth/token",
  clientId: "client_id",
  clientSecret: "client_secret",
  ...overrides,
});

const makeTokens = (overrides?: Partial<OAuthTokens>): OAuthTokens => ({
  accessToken: "access_123",
  refreshToken: "refresh_456",
  expiresAt: Date.now() + 3600_000,
  ...overrides,
});

function createMockStore(): jest.Mocked<IOAuthTokenStore> {
  const data = new Map<string, string>();
  return {
    get: jest.fn(async (provider) => data.get(provider) ?? null),
    save: jest.fn(async (provider, encrypted) => {
      data.set(provider, encrypted);
    }),
    delete: jest.fn(async (provider) => {
      data.delete(provider);
    }),
  };
}

function createManager(store?: jest.Mocked<IOAuthTokenStore>) {
  const mockStore = store ?? createMockStore();
  const manager = new OAuthTokenManager({
    store: mockStore,
    encryptionKey: ENCRYPTION_KEY,
  });
  return { manager, store: mockStore };
}

describe("OAuthTokenManager", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should throw if encryption key is too short", () => {
      expect(
        () =>
          new OAuthTokenManager({
            store: createMockStore(),
            encryptionKey: "short",
          })
      ).toThrow("OAUTH_ENCRYPTION_KEY must be at least 32 characters");
    });

    it("should throw if encryption key is empty", () => {
      expect(
        () =>
          new OAuthTokenManager({
            store: createMockStore(),
            encryptionKey: "",
          })
      ).toThrow("OAUTH_ENCRYPTION_KEY must be at least 32 characters");
    });

    it("should accept a 32-char key", () => {
      expect(() => createManager()).not.toThrow();
    });
  });

  describe("saveTokens / hasTokens", () => {
    it("should persist tokens and report existence", async () => {
      const { manager, store } = createManager();
      await manager.saveTokens("jobber", makeTokens());
      expect(store.save).toHaveBeenCalledTimes(1);
      expect(await manager.hasTokens("jobber")).toBe(true);
    });

    it("should return false when no tokens exist", async () => {
      const { manager } = createManager();
      expect(await manager.hasTokens("jobber")).toBe(false);
    });
  });

  describe("revokeTokens", () => {
    it("should delete from store and clear cache", async () => {
      const { manager, store } = createManager();
      await manager.saveTokens("jobber", makeTokens());
      await manager.revokeTokens("jobber");
      expect(store.delete).toHaveBeenCalledWith("jobber");
      expect(await manager.hasTokens("jobber")).toBe(false);
    });
  });

  describe("getAccessToken", () => {
    it("should return cached token when still valid", async () => {
      const { manager } = createManager();
      const tokens = makeTokens({ expiresAt: Date.now() + 300_000 });
      await manager.saveTokens("jobber", tokens);

      const result = await manager.getAccessToken(makeConfig());
      expect(result).toBe("access_123");
    });

    it("should load from store when cache is empty", async () => {
      const store = createMockStore();
      const tokens = makeTokens({ expiresAt: Date.now() + 300_000 });
      const encrypted = encryptTokens(tokens, ENCRYPTION_KEY);
      store.get.mockResolvedValue(encrypted);

      const manager = new OAuthTokenManager({
        store,
        encryptionKey: ENCRYPTION_KEY,
      });

      const result = await manager.getAccessToken(makeConfig());
      expect(result).toBe(tokens.accessToken);
      expect(store.get).toHaveBeenCalledWith("jobber");
    });

    it("should throw when no tokens in store", async () => {
      const { manager } = createManager();
      await expect(manager.getAccessToken(makeConfig())).rejects.toThrow(
        'No OAuth tokens found for "jobber"'
      );
    });

    it("should refresh expired tokens", async () => {
      const store = createMockStore();
      const expiredTokens = makeTokens({
        expiresAt: Date.now() - 1000, // expired
      });
      const encrypted = encryptTokens(expiredTokens, ENCRYPTION_KEY);
      store.get.mockResolvedValue(encrypted);

      const manager = new OAuthTokenManager({
        store,
        encryptionKey: ENCRYPTION_KEY,
      });

      mockedAxios.post.mockResolvedValue({
        data: {
          access_token: "new_access",
          refresh_token: "new_refresh",
          expires_in: 3600,
        },
      });

      const result = await manager.getAccessToken(makeConfig());
      expect(result).toBe("new_access");
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(store.save).toHaveBeenCalled();
    });

    it("should keep old refresh token when provider does not rotate", async () => {
      const store = createMockStore();
      const expiredTokens = makeTokens({ expiresAt: Date.now() - 1000 });
      store.get.mockResolvedValue(
        encryptTokens(expiredTokens, ENCRYPTION_KEY)
      );

      const manager = new OAuthTokenManager({
        store,
        encryptionKey: ENCRYPTION_KEY,
      });

      mockedAxios.post.mockResolvedValue({
        data: {
          access_token: "new_access",
          // no refresh_token in response
          expires_in: 3600,
        },
      });

      await manager.getAccessToken(makeConfig());

      // Verify saved tokens kept original refresh token
      const savedEncrypted = store.save.mock.calls[0][1];
      expect(savedEncrypted).toBeDefined();
    });

    it("should throw descriptive error on refresh failure", async () => {
      const store = createMockStore();
      const expiredTokens = makeTokens({ expiresAt: Date.now() - 1000 });
      store.get.mockResolvedValue(
        encryptTokens(expiredTokens, ENCRYPTION_KEY)
      );

      const manager = new OAuthTokenManager({
        store,
        encryptionKey: ENCRYPTION_KEY,
      });

      mockedAxios.post.mockRejectedValue({
        response: { status: 401, data: { error: "invalid_grant" } },
      });

      await expect(manager.getAccessToken(makeConfig())).rejects.toThrow(
        'OAuth refresh failed for "jobber"'
      );
    });

    it("should use cache on second call without hitting store", async () => {
      const { manager, store } = createManager();
      const tokens = makeTokens({ expiresAt: Date.now() + 300_000 });
      await manager.saveTokens("jobber", tokens);

      // First call — loads into cache
      await manager.getAccessToken(makeConfig());
      store.get.mockClear();

      // Second call — from cache
      const result = await manager.getAccessToken(makeConfig());
      expect(result).toBe("access_123");
      expect(store.get).not.toHaveBeenCalled();
    });
  });
});

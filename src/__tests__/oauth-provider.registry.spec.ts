import {
  loadOAuthProviders,
  getOAuthProvider,
  getOAuthProviderNames,
  resolveOAuthProviderConfig,
  buildOAuthAuthorizationUrl,
  type OAuthProviderDef,
} from "../oauth/oauth-provider.registry";

const makeDef = (overrides?: Partial<OAuthProviderDef>): OAuthProviderDef => ({
  name: "jobber",
  authorizationUrl: "https://api.getjobber.com/oauth/authorize",
  tokenUrl: "https://api.getjobber.com/oauth/token",
  scopes: ["read", "write"],
  clientIdEnvVar: "JOBBER_CLIENT_ID",
  clientSecretEnvVar: "JOBBER_CLIENT_SECRET",
  ...overrides,
});

describe("OAuthProviderRegistry", () => {
  beforeEach(() => {
    // Reset registry
    loadOAuthProviders({});
    delete process.env.JOBBER_CLIENT_ID;
    delete process.env.JOBBER_CLIENT_SECRET;
  });

  describe("loadOAuthProviders / getOAuthProvider", () => {
    it("should load and retrieve a provider", () => {
      const def = makeDef();
      loadOAuthProviders({ jobber: def });
      expect(getOAuthProvider("jobber")).toEqual(def);
    });

    it("should throw for unknown provider", () => {
      expect(() => getOAuthProvider("unknown")).toThrow(
        "Unknown OAuth provider: unknown"
      );
    });

    it("should overwrite registry on re-load", () => {
      loadOAuthProviders({ a: makeDef({ name: "a" }) });
      loadOAuthProviders({ b: makeDef({ name: "b" }) });
      expect(getOAuthProviderNames()).toEqual(["b"]);
    });
  });

  describe("getOAuthProviderNames", () => {
    it("should return empty array when no providers loaded", () => {
      expect(getOAuthProviderNames()).toEqual([]);
    });

    it("should return all loaded provider keys", () => {
      loadOAuthProviders({
        jobber: makeDef(),
        hubspot: makeDef({ name: "hubspot" }),
      });
      expect(getOAuthProviderNames()).toEqual(["jobber", "hubspot"]);
    });
  });

  describe("resolveOAuthProviderConfig", () => {
    it("should resolve config from env vars", () => {
      loadOAuthProviders({ jobber: makeDef() });
      process.env.JOBBER_CLIENT_ID = "id_123";
      process.env.JOBBER_CLIENT_SECRET = "secret_456";

      const config = resolveOAuthProviderConfig("jobber");
      expect(config).toEqual({
        provider: "jobber",
        tokenUrl: "https://api.getjobber.com/oauth/token",
        clientId: "id_123",
        clientSecret: "secret_456",
      });
    });

    it("should throw when client ID env var is missing", () => {
      loadOAuthProviders({ jobber: makeDef() });
      process.env.JOBBER_CLIENT_SECRET = "secret";
      expect(() => resolveOAuthProviderConfig("jobber")).toThrow(
        "Missing env var: JOBBER_CLIENT_ID"
      );
    });

    it("should throw when client secret env var is missing", () => {
      loadOAuthProviders({ jobber: makeDef() });
      process.env.JOBBER_CLIENT_ID = "id";
      expect(() => resolveOAuthProviderConfig("jobber")).toThrow(
        "Missing env var: JOBBER_CLIENT_SECRET"
      );
    });
  });

  describe("buildOAuthAuthorizationUrl", () => {
    beforeEach(() => {
      loadOAuthProviders({ jobber: makeDef() });
      process.env.JOBBER_CLIENT_ID = "id_123";
    });

    it("should build URL with scopes", () => {
      const url = buildOAuthAuthorizationUrl("jobber", {
        redirectUri: "http://localhost/callback",
        state: "state_abc",
      });
      const parsed = new URL(url);
      expect(parsed.origin + parsed.pathname).toBe(
        "https://api.getjobber.com/oauth/authorize"
      );
      expect(parsed.searchParams.get("client_id")).toBe("id_123");
      expect(parsed.searchParams.get("redirect_uri")).toBe(
        "http://localhost/callback"
      );
      expect(parsed.searchParams.get("response_type")).toBe("code");
      expect(parsed.searchParams.get("state")).toBe("state_abc");
      expect(parsed.searchParams.get("scope")).toBe("read write");
    });

    it("should omit scope when scopes array is empty", () => {
      loadOAuthProviders({ noscope: makeDef({ name: "noscope", scopes: [] }) });
      const url = buildOAuthAuthorizationUrl("noscope", {
        redirectUri: "http://localhost/callback",
        state: "s",
      });
      const parsed = new URL(url);
      expect(parsed.searchParams.has("scope")).toBe(false);
    });

    it("should throw when client ID env var is missing", () => {
      delete process.env.JOBBER_CLIENT_ID;
      expect(() =>
        buildOAuthAuthorizationUrl("jobber", {
          redirectUri: "http://localhost",
          state: "s",
        })
      ).toThrow("Missing env var: JOBBER_CLIENT_ID");
    });
  });
});

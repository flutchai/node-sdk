import { encryptTokens, decryptTokens } from "../oauth/oauth-crypto.utils";
import type { OAuthTokens } from "../oauth/oauth-token.interfaces";

const ENCRYPTION_KEY = "a]1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p"; // 32 chars

const makeTokens = (overrides?: Partial<OAuthTokens>): OAuthTokens => ({
  accessToken: "access_123",
  refreshToken: "refresh_456",
  expiresAt: Date.now() + 3600_000,
  ...overrides,
});

describe("OAuthCryptoUtils", () => {
  describe("encryptTokens / decryptTokens", () => {
    it("should round-trip encrypt and decrypt tokens", () => {
      const tokens = makeTokens();
      const encrypted = encryptTokens(tokens, ENCRYPTION_KEY);
      const decrypted = decryptTokens(encrypted, ENCRYPTION_KEY);
      expect(decrypted).toEqual(tokens);
    });

    it("should produce iv:data format", () => {
      const encrypted = encryptTokens(makeTokens(), ENCRYPTION_KEY);
      const parts = encrypted.split(":");
      expect(parts).toHaveLength(2);
      expect(parts[0]).toHaveLength(32); // 16 bytes = 32 hex chars
    });

    it("should produce different ciphertext each time (random IV)", () => {
      const tokens = makeTokens();
      const a = encryptTokens(tokens, ENCRYPTION_KEY);
      const b = encryptTokens(tokens, ENCRYPTION_KEY);
      expect(a).not.toBe(b);
    });
  });

  describe("decryptTokens — error cases", () => {
    it("should throw on missing separator", () => {
      expect(() => decryptTokens("no_separator_here", ENCRYPTION_KEY)).toThrow(
        "Invalid encrypted token format"
      );
    });

    it("should throw on corrupted data", () => {
      expect(() =>
        decryptTokens("0000000000000000:corrupted", ENCRYPTION_KEY)
      ).toThrow();
    });

    it("should throw with wrong key", () => {
      const encrypted = encryptTokens(makeTokens(), ENCRYPTION_KEY);
      const wrongKey = "x".repeat(32);
      expect(() => decryptTokens(encrypted, wrongKey)).toThrow();
    });
  });
});

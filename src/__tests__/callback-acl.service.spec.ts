import { ForbiddenException } from "@nestjs/common";
import { CallbackACL } from "../callbacks/callback-acl.service";

describe("CallbackACL", () => {
  let acl: CallbackACL;

  beforeEach(() => {
    acl = new CallbackACL();
  });

  const makeRecord = (overrides: Record<string, any> = {}) => ({
    token: "tok_1",
    graphType: "chat::1.0.0",
    handler: "confirm",
    userId: "user-1",
    createdAt: Date.now(),
    retries: 0,
    status: "pending",
    metadata: { ttlSec: 600 },
    ...overrides,
  });

  const makeUser = (overrides: Record<string, any> = {}) => ({
    userId: "user-1",
    roles: [],
    permissions: [],
    ...overrides,
  });

  describe("validate", () => {
    it("should allow valid user with matching userId", async () => {
      const result = await acl.validate(makeUser(), makeRecord() as any);
      expect(result.allowed).toBe(true);
    });

    it("should reject unauthenticated user", async () => {
      await expect(
        acl.validate(undefined, makeRecord() as any)
      ).rejects.toThrow(ForbiddenException);
    });

    it("should reject user with different userId", async () => {
      await expect(
        acl.validate(makeUser({ userId: "other-user" }), makeRecord() as any)
      ).rejects.toThrow("Cannot execute callback for another user");
    });

    it("should allow when record has no userId restriction", async () => {
      const result = await acl.validate(
        makeUser({ userId: "any-user" }),
        makeRecord({ userId: undefined }) as any
      );
      expect(result.allowed).toBe(true);
    });

    it("should reject expired callback", async () => {
      const expiredRecord = makeRecord({
        createdAt: Date.now() - 700_000, // 700s ago, ttl is 600s
        metadata: { ttlSec: 600 },
      });

      await expect(
        acl.validate(makeUser(), expiredRecord as any)
      ).rejects.toThrow("Callback token has expired");
    });

    it("should reject callback with too many retries", async () => {
      const retriedRecord = makeRecord({ retries: 4 });

      await expect(
        acl.validate(makeUser(), retriedRecord as any)
      ).rejects.toThrow("exceeded maximum retry attempts");
    });
  });

  describe("canRetry", () => {
    it("should allow retry for matching user in failed state", async () => {
      const record = makeRecord({ status: "failed", retries: 1 });
      const result = await acl.canRetry(makeUser(), record as any);
      expect(result).toBe(true);
    });

    it("should allow retry in processing state", async () => {
      const record = makeRecord({ status: "processing", retries: 0 });
      const result = await acl.canRetry(makeUser(), record as any);
      expect(result).toBe(true);
    });

    it("should deny retry for different user", async () => {
      const record = makeRecord({ status: "failed" });
      const result = await acl.canRetry(
        makeUser({ userId: "other" }),
        record as any
      );
      expect(result).toBe(false);
    });

    it("should deny retry when retries >= 3", async () => {
      const record = makeRecord({ status: "failed", retries: 3 });
      const result = await acl.canRetry(makeUser(), record as any);
      expect(result).toBe(false);
    });

    it("should deny retry for completed callbacks", async () => {
      const record = makeRecord({ status: "completed" });
      const result = await acl.canRetry(makeUser(), record as any);
      expect(result).toBe(false);
    });
  });

  describe("getPermissionDetails", () => {
    it("should return permission details", () => {
      const user = makeUser({
        roles: ["admin"],
        permissions: ["graph:finance:read"],
        companyId: "company-1",
      });
      const record = makeRecord({
        metadata: {
          scopes: ["finance:write"],
          companyId: "company-1",
          ttlSec: 600,
        },
      });

      const details = acl.getPermissionDetails(user, record as any);

      expect(details.userId).toBe("user-1");
      expect(details.userIdMatch).toBe(true);
      expect(details.requiredScopes).toEqual(["finance:write"]);
      expect(details.userRoles).toEqual(["admin"]);
      expect(details.companyMatch).toBe(true);
    });

    it("should show companyMatch as true when no company required", () => {
      const details = acl.getPermissionDetails(
        makeUser(),
        makeRecord({ metadata: {} }) as any
      );
      expect(details.companyMatch).toBe(true);
    });
  });
});

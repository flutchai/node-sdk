import { GraphTypeUtils } from "../utils/graph-type.utils";

describe("GraphTypeUtils", () => {
  describe("parse", () => {
    it("should parse full type with version", () => {
      const result = GraphTypeUtils.parse("global.simple::1.2.0");
      expect(result).toEqual({
        companyId: "global",
        name: "simple",
        version: "1.2.0",
      });
    });

    it("should parse type with prerelease version", () => {
      const result = GraphTypeUtils.parse("company-123.customRag::2.1.0-beta");
      expect(result).toEqual({
        companyId: "company-123",
        name: "customRag",
        version: "2.1.0-beta",
      });
    });

    it("should parse type without version", () => {
      const result = GraphTypeUtils.parse("global.simple");
      expect(result).toEqual({
        companyId: "global",
        name: "simple",
        version: undefined,
      });
    });

    it("should parse legacy format (name only)", () => {
      const result = GraphTypeUtils.parse("simple");
      expect(result).toEqual({
        companyId: "global",
        name: "simple",
        version: undefined,
      });
    });
  });

  describe("build", () => {
    it("should build full type with version", () => {
      expect(GraphTypeUtils.build("global", "simple", "1.0.0")).toBe(
        "global.simple::1.0.0"
      );
    });

    it("should build type without version", () => {
      expect(GraphTypeUtils.build("global", "simple")).toBe("global.simple");
    });
  });

  describe("normalize", () => {
    it("should normalize full type", () => {
      expect(GraphTypeUtils.normalize("global.simple::1.0.0")).toBe(
        "global.simple::1.0.0"
      );
    });

    it("should normalize legacy format", () => {
      expect(GraphTypeUtils.normalize("simple")).toBe("global.simple");
    });

    it("should normalize type without version", () => {
      expect(GraphTypeUtils.normalize("company.rag")).toBe("company.rag");
    });
  });

  describe("getBaseType", () => {
    it("should strip version from full type", () => {
      expect(GraphTypeUtils.getBaseType("global.simple::1.0.0")).toBe(
        "global.simple"
      );
    });

    it("should return base type as-is when no version", () => {
      expect(GraphTypeUtils.getBaseType("global.simple")).toBe("global.simple");
    });

    it("should normalize legacy format", () => {
      expect(GraphTypeUtils.getBaseType("simple")).toBe("global.simple");
    });
  });

  describe("getVersion", () => {
    it("should extract version from full type", () => {
      expect(GraphTypeUtils.getVersion("global.simple::1.2.3")).toBe("1.2.3");
    });

    it("should return undefined when no version", () => {
      expect(GraphTypeUtils.getVersion("global.simple")).toBeUndefined();
    });
  });

  describe("isValidVersion", () => {
    it("should accept valid semver versions", () => {
      expect(GraphTypeUtils.isValidVersion("1.0.0")).toBe(true);
      expect(GraphTypeUtils.isValidVersion("2.10.3")).toBe(true);
      expect(GraphTypeUtils.isValidVersion("0.0.1")).toBe(true);
    });

    it("should accept versions with prerelease", () => {
      expect(GraphTypeUtils.isValidVersion("1.0.0-alpha")).toBe(true);
      expect(GraphTypeUtils.isValidVersion("2.0.0-beta.1")).toBe(true);
      expect(GraphTypeUtils.isValidVersion("1.0.0-rc.2")).toBe(true);
    });

    it("should reject invalid versions", () => {
      expect(GraphTypeUtils.isValidVersion("1.0")).toBe(false);
      expect(GraphTypeUtils.isValidVersion("abc")).toBe(false);
      expect(GraphTypeUtils.isValidVersion("")).toBe(false);
      expect(GraphTypeUtils.isValidVersion("1")).toBe(false);
    });
  });

  describe("isSystemGraph", () => {
    it("should return true for global graphs", () => {
      expect(GraphTypeUtils.isSystemGraph("global.simple")).toBe(true);
      expect(GraphTypeUtils.isSystemGraph("global.simple::1.0.0")).toBe(true);
    });

    it("should return false for company graphs", () => {
      expect(GraphTypeUtils.isSystemGraph("company-123.rag")).toBe(false);
    });

    it("should return true for legacy format (defaults to global)", () => {
      expect(GraphTypeUtils.isSystemGraph("simple")).toBe(true);
    });
  });

  describe("compareVersions", () => {
    it("should compare by major version", () => {
      expect(GraphTypeUtils.compareVersions("2.0.0", "1.0.0")).toBeGreaterThan(
        0
      );
      expect(GraphTypeUtils.compareVersions("1.0.0", "2.0.0")).toBeLessThan(0);
    });

    it("should compare by minor version", () => {
      expect(GraphTypeUtils.compareVersions("1.2.0", "1.1.0")).toBeGreaterThan(
        0
      );
      expect(GraphTypeUtils.compareVersions("1.1.0", "1.2.0")).toBeLessThan(0);
    });

    it("should compare by patch version", () => {
      expect(GraphTypeUtils.compareVersions("1.0.2", "1.0.1")).toBeGreaterThan(
        0
      );
      expect(GraphTypeUtils.compareVersions("1.0.1", "1.0.2")).toBeLessThan(0);
    });

    it("should return 0 for equal versions", () => {
      expect(GraphTypeUtils.compareVersions("1.0.0", "1.0.0")).toBe(0);
    });

    it("should rank prerelease lower than release", () => {
      expect(
        GraphTypeUtils.compareVersions("1.0.0-alpha", "1.0.0")
      ).toBeLessThan(0);
      expect(
        GraphTypeUtils.compareVersions("1.0.0", "1.0.0-alpha")
      ).toBeGreaterThan(0);
    });

    it("should compare prerelease strings lexicographically", () => {
      const result = GraphTypeUtils.compareVersions(
        "1.0.0-alpha",
        "1.0.0-beta"
      );
      expect(result).toBeLessThan(0);
    });

    it("should return 0 for equal prerelease versions", () => {
      expect(GraphTypeUtils.compareVersions("1.0.0-rc.1", "1.0.0-rc.1")).toBe(
        0
      );
    });
  });
});

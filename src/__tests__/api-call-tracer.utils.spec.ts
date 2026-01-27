import { sanitizeTraceData } from "../engines/api-call-tracer.utils";

describe("sanitizeTraceData", () => {
  describe("primitives", () => {
    it("should return undefined as-is", () => {
      expect(sanitizeTraceData(undefined)).toBeUndefined();
    });

    it("should return null as-is", () => {
      expect(sanitizeTraceData(null)).toBeNull();
    });

    it("should return strings as-is", () => {
      expect(sanitizeTraceData("hello")).toBe("hello");
    });

    it("should return numbers as-is", () => {
      expect(sanitizeTraceData(42)).toBe(42);
      expect(sanitizeTraceData(3.14)).toBe(3.14);
    });

    it("should return booleans as-is", () => {
      expect(sanitizeTraceData(true)).toBe(true);
      expect(sanitizeTraceData(false)).toBe(false);
    });

    it("should convert bigint to string", () => {
      expect(sanitizeTraceData(BigInt(123))).toBe("123");
    });
  });

  describe("special types", () => {
    it("should convert Date to ISO string", () => {
      const date = new Date("2026-01-27T12:00:00Z");
      expect(sanitizeTraceData(date)).toBe("2026-01-27T12:00:00.000Z");
    });

    it("should convert Error to object with name, message, stack", () => {
      const error = new Error("test error");
      const result = sanitizeTraceData(error) as Record<string, unknown>;

      expect(result.name).toBe("Error");
      expect(result.message).toBe("test error");
      expect(result.stack).toBeDefined();
    });
  });

  describe("arrays", () => {
    it("should sanitize array elements recursively", () => {
      const result = sanitizeTraceData([1, "two", true, null]);
      expect(result).toEqual([1, "two", true, null]);
    });

    it("should handle nested arrays", () => {
      const result = sanitizeTraceData([
        [1, 2],
        [3, 4],
      ]);
      expect(result).toEqual([
        [1, 2],
        [3, 4],
      ]);
    });
  });

  describe("objects", () => {
    it("should sanitize plain objects recursively", () => {
      const result = sanitizeTraceData({ a: 1, b: "two", c: true });
      expect(result).toEqual({ a: 1, b: "two", c: true });
    });

    it("should handle nested objects", () => {
      const result = sanitizeTraceData({ outer: { inner: "value" } });
      expect(result).toEqual({ outer: { inner: "value" } });
    });
  });

  describe("circular references", () => {
    it("should handle circular object references by returning undefined", () => {
      const obj: any = { a: 1 };
      obj.self = obj;

      const result = sanitizeTraceData(obj) as Record<string, unknown>;
      expect(result.a).toBe(1);
      // circular ref should be skipped (undefined filtered out)
      expect(result.self).toBeUndefined();
    });

    it("should handle circular array references", () => {
      const arr: any[] = [1, 2];
      arr.push(arr);

      const result = sanitizeTraceData(arr) as any[];
      expect(result[0]).toBe(1);
      expect(result[1]).toBe(2);
      // circular ref filtered out
      expect(result).toHaveLength(2);
    });
  });

  describe("depth limit", () => {
    it("should replace deeply nested objects with [Object]", () => {
      let deep: any = { value: "leaf" };
      for (let i = 0; i < 20; i++) {
        deep = { nested: deep };
      }

      const result = sanitizeTraceData(deep) as any;
      // Should hit depth limit and return "[Object]" at some level
      let current = result;
      let foundPlaceholder = false;
      for (let i = 0; i < 20; i++) {
        if (current?.nested === "[Object]") {
          foundPlaceholder = true;
          break;
        }
        current = current?.nested;
      }
      expect(foundPlaceholder).toBe(true);
    });

    it("should replace deeply nested arrays with [Array]", () => {
      let deep: any = ["leaf"];
      for (let i = 0; i < 20; i++) {
        deep = [deep];
      }

      const result = sanitizeTraceData(deep) as any;
      let current = result;
      let foundPlaceholder = false;
      for (let i = 0; i < 20; i++) {
        if (current?.[0] === "[Array]") {
          foundPlaceholder = true;
          break;
        }
        current = current?.[0];
      }
      expect(foundPlaceholder).toBe(true);
    });
  });

  describe("Set and Map", () => {
    it("should convert Set to array", () => {
      const set = new Set([1, 2, 3]);
      const result = sanitizeTraceData(set);
      expect(result).toEqual([1, 2, 3]);
    });

    it("should convert Map to object", () => {
      const map = new Map<string, number>([
        ["a", 1],
        ["b", 2],
      ]);
      const result = sanitizeTraceData(map);
      expect(result).toEqual({ a: 1, b: 2 });
    });
  });

  describe("unknown types", () => {
    it("should convert symbols and other types to string", () => {
      const fn = () => {};
      const result = sanitizeTraceData(fn);
      expect(typeof result).toBe("string");
    });
  });
});

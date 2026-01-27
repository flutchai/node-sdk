import {
  isError,
  getErrorMessage,
  getErrorStack,
  formatError,
  formatErrorForProduction,
  logError,
} from "../utils/error.utils";

describe("error.utils", () => {
  describe("isError", () => {
    it("should return true for Error instances", () => {
      expect(isError(new Error("test"))).toBe(true);
      expect(isError(new TypeError("type"))).toBe(true);
    });

    it("should return false for non-Error values", () => {
      expect(isError("string")).toBe(false);
      expect(isError(42)).toBe(false);
      expect(isError(null)).toBe(false);
      expect(isError(undefined)).toBe(false);
      expect(isError({ message: "not an error" })).toBe(false);
    });
  });

  describe("getErrorMessage", () => {
    it("should extract message from Error", () => {
      expect(getErrorMessage(new Error("test message"))).toBe("test message");
    });

    it("should return string errors directly", () => {
      expect(getErrorMessage("string error")).toBe("string error");
    });

    it("should extract message from object with message property", () => {
      expect(getErrorMessage({ message: "obj message" })).toBe("obj message");
    });

    it("should JSON.stringify objects without message", () => {
      expect(getErrorMessage({ code: 404 })).toBe('{"code":404}');
    });

    it("should convert other types to string", () => {
      expect(getErrorMessage(42)).toBe("42");
      expect(getErrorMessage(null)).toBe("null");
      expect(getErrorMessage(undefined)).toBe("undefined");
      expect(getErrorMessage(true)).toBe("true");
    });
  });

  describe("getErrorStack", () => {
    it("should return stack from Error", () => {
      const err = new Error("test");
      expect(getErrorStack(err)).toBe(err.stack);
    });

    it("should return stack from object with stack property", () => {
      const obj = { stack: "fake stack trace" };
      expect(getErrorStack(obj)).toBe("fake stack trace");
    });

    it("should return undefined for values without stack", () => {
      expect(getErrorStack("string")).toBeUndefined();
      expect(getErrorStack(42)).toBeUndefined();
      expect(getErrorStack(null)).toBeUndefined();
      expect(getErrorStack({ message: "no stack" })).toBeUndefined();
    });
  });

  describe("formatError", () => {
    it("should format Error with message and stack", () => {
      const err = new Error("test");
      const result = formatError(err);

      expect(result.message).toBe("test");
      expect(result.stack).toBeDefined();
    });

    it("should include code property from Error", () => {
      const err = new Error("not found") as any;
      err.code = "ENOENT";

      const result = formatError(err);
      expect(result.code).toBe("ENOENT");
    });

    it("should include statusCode from Error", () => {
      const err = new Error("bad request") as any;
      err.statusCode = 400;

      const result = formatError(err);
      expect(result.statusCode).toBe(400);
    });

    it("should include response as details from Error", () => {
      const err = new Error("api error") as any;
      err.response = { data: "error body" };

      const result = formatError(err);
      expect(result.details).toEqual({ data: "error body" });
    });

    it("should format string errors", () => {
      const result = formatError("string error");
      expect(result.message).toBe("string error");
      expect(result.stack).toBeUndefined();
    });

    it("should format object errors with message", () => {
      const result = formatError({ message: "obj error", code: "ERR" });
      expect(result.message).toBe("obj error");
      expect(result.code).toBe("ERR");
    });

    it("should format object errors with statusCode", () => {
      const result = formatError({ message: "bad", statusCode: 500 });
      expect(result.statusCode).toBe(500);
    });

    it("should format object errors without message", () => {
      const result = formatError({ foo: "bar" });
      expect(result.message).toBe('{"foo":"bar"}');
    });

    it("should format primitive errors", () => {
      expect(formatError(42).message).toBe("42");
      expect(formatError(null).message).toBe("null");
      expect(formatError(undefined).message).toBe("undefined");
    });
  });

  describe("formatErrorForProduction", () => {
    it("should strip stack and details", () => {
      const err = new Error("prod error") as any;
      err.response = { secret: "data" };

      const result = formatErrorForProduction(err);
      expect(result.message).toBe("prod error");
      expect((result as any).stack).toBeUndefined();
      expect((result as any).details).toBeUndefined();
    });

    it("should preserve code and statusCode", () => {
      const err = new Error("error") as any;
      err.code = "TIMEOUT";
      err.statusCode = 504;

      const result = formatErrorForProduction(err);
      expect(result.code).toBe("TIMEOUT");
      expect(result.statusCode).toBe(504);
    });
  });

  describe("logError", () => {
    it("should call logger.error with formatted error", () => {
      const mockLogger = { error: jest.fn() };
      const err = new Error("log test");

      logError(mockLogger, err, "TestContext");

      expect(mockLogger.error).toHaveBeenCalledWith(
        "TestContext",
        expect.objectContaining({ message: "log test" })
      );
    });

    it("should include additional data", () => {
      const mockLogger = { error: jest.fn() };

      logError(mockLogger, new Error("err"), "Ctx", { userId: "123" });

      expect(mockLogger.error).toHaveBeenCalledWith(
        "Ctx",
        expect.objectContaining({ userId: "123" })
      );
    });

    it("should strip stack in production mode", () => {
      const originalEnv = process.env.ENV;
      process.env.ENV = "prod";

      const mockLogger = { error: jest.fn() };
      logError(mockLogger, new Error("prod err"), "Ctx");

      const loggedData = mockLogger.error.mock.calls[0][1];
      expect(loggedData.stack).toBeUndefined();
      expect(loggedData.details).toBeUndefined();

      process.env.ENV = originalEnv;
    });
  });
});

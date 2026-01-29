import { createMongoClientAdapter } from "../core/mongodb/mongodb-client.adapter";

describe("createMongoClientAdapter", () => {
  function createMockClient() {
    return {
      db: jest.fn(),
      close: jest.fn(),
      connect: jest.fn(),
    };
  }

  it("should return the client when all required methods exist", () => {
    const mock = createMockClient();
    const result = createMongoClientAdapter(mock);
    expect(result).toBe(mock);
  });

  it("should throw when client is null", () => {
    expect(() => createMongoClientAdapter(null)).toThrow(
      "Invalid MongoDB client: missing required methods"
    );
  });

  it("should throw when client is undefined", () => {
    expect(() => createMongoClientAdapter(undefined)).toThrow(
      "Invalid MongoDB client: missing required methods"
    );
  });

  it("should throw when db method is missing", () => {
    expect(() => createMongoClientAdapter({ close: jest.fn(), connect: jest.fn() })).toThrow(
      "Invalid MongoDB client: missing required methods"
    );
  });

  it("should throw when close method is missing", () => {
    expect(() =>
      createMongoClientAdapter({ db: jest.fn(), connect: jest.fn() })
    ).toThrow("Invalid MongoDB client: missing required method 'close'");
  });

  it("should throw when connect method is missing", () => {
    expect(() =>
      createMongoClientAdapter({ db: jest.fn(), close: jest.fn() })
    ).toThrow("Invalid MongoDB client: missing required method 'connect'");
  });
});

import { redactConnectionString } from "../utils/redact.utils";

describe("redactConnectionString", () => {
  it("removes user and password, keeps hosts, db and options", () => {
    expect(
      redactConnectionString(
        "mongodb://user:p4ss@cluster0-shard-00-00.x.net:27017,cluster0-shard-00-01.x.net:27017/?ssl=true&replicaSet=atlas-1&authSource=admin"
      )
    ).toBe(
      "mongodb://***@cluster0-shard-00-00.x.net:27017,cluster0-shard-00-01.x.net:27017/?ssl=true&replicaSet=atlas-1&authSource=admin"
    );
  });

  it("handles srv URIs and passwords containing @", () => {
    expect(
      redactConnectionString("mongodb+srv://u:p@ss@c.mongodb.net/amelie")
    ).toBe("mongodb+srv://***@c.mongodb.net/amelie");
  });

  it("masks secret-looking query parameters", () => {
    expect(
      redactConnectionString(
        "redis://h:6379/0?password=abc&tlsCertificateKeyFilePassword=x&db=1#frag"
      )
    ).toBe(
      "redis://h:6379/0?password=***&tlsCertificateKeyFilePassword=***&db=1#frag"
    );
  });

  it("leaves URIs without credentials as they are", () => {
    expect(redactConnectionString("mongodb://localhost:27017/test")).toBe(
      "mongodb://localhost:27017/test"
    );
  });

  it("fully redacts values that are not URIs", () => {
    expect(redactConnectionString("user:pass host")).toBe("[redacted]");
    expect(redactConnectionString(undefined)).toBe("");
  });
});

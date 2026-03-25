import { MongoTokenStore } from "../oauth/stores/mongo-token.store";

function createMockCollection() {
  return {
    findOne: jest.fn(),
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
    createIndex: jest.fn(),
  };
}

function createMockDb(collection?: ReturnType<typeof createMockCollection>) {
  const col = collection ?? createMockCollection();
  return {
    db: { collection: jest.fn(() => col) } as any,
    col,
  };
}

describe("MongoTokenStore", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should use default collection name", () => {
      const { db, col } = createMockDb();
      const store = new MongoTokenStore(db);
      col.findOne.mockResolvedValue(null);
      col.createIndex.mockResolvedValue("ok");
      store.get("jobber");
      // Verify collection name on first call
      expect(db.collection).toHaveBeenCalledWith("oauth_tokens");
    });

    it("should accept custom collection name", () => {
      const { db, col } = createMockDb();
      const store = new MongoTokenStore(db, "custom_tokens");
      col.findOne.mockResolvedValue(null);
      col.createIndex.mockResolvedValue("ok");
      store.get("jobber");
      expect(db.collection).toHaveBeenCalledWith("custom_tokens");
    });
  });

  describe("get", () => {
    it("should return encrypted value when document exists", async () => {
      const { db, col } = createMockDb();
      col.createIndex.mockResolvedValue("ok");
      col.findOne.mockResolvedValue({
        provider: "jobber",
        encrypted: "enc_data",
      });
      const store = new MongoTokenStore(db);
      const result = await store.get("jobber");
      expect(result).toBe("enc_data");
      expect(col.findOne).toHaveBeenCalledWith({ provider: "jobber" });
    });

    it("should return null when document does not exist", async () => {
      const { db, col } = createMockDb();
      col.createIndex.mockResolvedValue("ok");
      col.findOne.mockResolvedValue(null);
      const store = new MongoTokenStore(db);
      const result = await store.get("jobber");
      expect(result).toBeNull();
    });
  });

  describe("save", () => {
    it("should upsert with encrypted data and timestamp", async () => {
      const { db, col } = createMockDb();
      col.createIndex.mockResolvedValue("ok");
      col.updateOne.mockResolvedValue({ acknowledged: true });
      const store = new MongoTokenStore(db);

      await store.save("jobber", "enc_data");

      expect(col.updateOne).toHaveBeenCalledWith(
        { provider: "jobber" },
        {
          $set: {
            provider: "jobber",
            encrypted: "enc_data",
            updatedAt: expect.any(Date),
          },
        },
        { upsert: true }
      );
    });
  });

  describe("delete", () => {
    it("should delete by provider", async () => {
      const { db, col } = createMockDb();
      col.deleteOne.mockResolvedValue({ deletedCount: 1 });
      const store = new MongoTokenStore(db);
      await store.delete("jobber");
      expect(col.deleteOne).toHaveBeenCalledWith({ provider: "jobber" });
    });
  });

  describe("ensureIndex", () => {
    it("should create unique index on first call only", async () => {
      const { db, col } = createMockDb();
      col.createIndex.mockResolvedValue("ok");
      col.findOne.mockResolvedValue(null);
      const store = new MongoTokenStore(db);

      await store.get("a");
      await store.get("b");
      await store.get("c");

      expect(col.createIndex).toHaveBeenCalledTimes(1);
      expect(col.createIndex).toHaveBeenCalledWith(
        { provider: 1 },
        { unique: true }
      );
    });
  });
});

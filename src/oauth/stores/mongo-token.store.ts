/**
 * MongoDB-based OAuth token store.
 * Stores encrypted tokens in a MongoDB collection.
 * Suitable for cloud / multi-tenant / stateless deployments.
 */
import type { Db } from "mongodb";
import type { IOAuthTokenStore } from "../oauth-token.interfaces";

const DEFAULT_COLLECTION = "oauth_tokens";

export class MongoTokenStore implements IOAuthTokenStore {
  private readonly collectionName: string;
  private initialized = false;

  constructor(
    private readonly db: Db,
    collectionName?: string,
  ) {
    this.collectionName = collectionName ?? DEFAULT_COLLECTION;
  }

  async get(provider: string): Promise<string | null> {
    await this.ensureIndex();
    const doc = await this.db
      .collection(this.collectionName)
      .findOne({ provider });
    return (doc?.encrypted as string) ?? null;
  }

  async save(provider: string, encrypted: string): Promise<void> {
    await this.ensureIndex();
    await this.db.collection(this.collectionName).updateOne(
      { provider },
      { $set: { provider, encrypted, updatedAt: new Date() } },
      { upsert: true },
    );
  }

  async delete(provider: string): Promise<void> {
    await this.db.collection(this.collectionName).deleteOne({ provider });
  }

  private async ensureIndex(): Promise<void> {
    if (this.initialized) return;
    await this.db
      .collection(this.collectionName)
      .createIndex({ provider: 1 }, { unique: true });
    this.initialized = true;
  }
}

/**
 * MongoDB Client Adapter
 *
 * Resolves type conflicts between mongoose's mongodb and @langchain/langgraph-checkpoint-mongodb's mongodb
 * by creating a compatible client interface.
 */

import type { MongoClient } from "mongodb";

/**
 * Creates a type-safe MongoDB client adapter
 *
 * This adapter ensures that a MongoClient from mongoose.Connection.getClient()
 * is compatible with the MongoClient expected by @langchain/langgraph-checkpoint-mongodb.
 *
 * The issue: mongoose and @langchain/langgraph-checkpoint-mongodb may have different
 * mongodb package versions in their dependency trees, causing TypeScript to see them
 * as incompatible types even though they are structurally identical at runtime.
 *
 * This adapter provides runtime validation and a safe type bridge.
 *
 * @param mongooseClient - MongoClient from mongoose connection (any type to accept both versions)
 * @returns MongoClient compatible with checkpoint-mongodb
 */
export function createMongoClientAdapter(mongooseClient: any): MongoClient {
  // Runtime validation - ensure it's actually a MongoClient
  if (!mongooseClient || typeof mongooseClient.db !== "function") {
    throw new Error(
      "Invalid MongoDB client: missing required methods. Expected MongoClient from mongoose.Connection.getClient()"
    );
  }

  // Validate key methods exist
  const requiredMethods = ["db", "close", "connect"];
  for (const method of requiredMethods) {
    if (typeof (mongooseClient as any)[method] !== "function") {
      throw new Error(
        `Invalid MongoDB client: missing required method '${method}'`
      );
    }
  }

  // The client is structurally compatible at runtime, but TypeScript sees different types
  // due to separate mongodb package declarations in node_modules hierarchy.
  // We use a structural type assertion based on the actual interface compatibility.
  return mongooseClient as unknown as MongoClient;
}

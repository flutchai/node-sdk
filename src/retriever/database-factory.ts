import mongoose, { Connection } from "mongoose";
import { Logger } from "@nestjs/common";

export interface DatabaseConfig {
  /**
   * Main database URI (where knowledge bases are stored)
   * Used for retriever
   */
  mainDbUri: string;

  /**
   * Database URI for specific graph (for checkpointer)
   * Can be separate for each graph
   */
  graphDbUri: string;

  /**
   * Graph name (for database naming)
   */
  graphName: string;
}

/**
 * Factory for creating database connections
 */
export class DatabaseFactory {
  private static readonly logger = new Logger(DatabaseFactory.name);
  private static connections: Map<string, Connection> = new Map();

  /**
   * Get connection to main database
   * Always the same for all graphs
   */
  static async getMainDbConnection(mainDbUri: string): Promise<Connection> {
    const connectionKey = `main:${mainDbUri}`;

    if (this.connections.has(connectionKey)) {
      return this.connections.get(connectionKey)!;
    }

    this.logger.debug(`Creating connection to main database: ${mainDbUri}`);

    const connection = await mongoose.createConnection(mainDbUri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4,
      bufferCommands: false,
    });

    this.connections.set(connectionKey, connection);

    this.logger.log(`Connected to main database: ${mainDbUri}`);

    return connection;
  }

  /**
   * Get connection to graph database
   * Can be separate for each graph
   */
  static async getGraphDbConnection(
    graphDbUri: string,
    graphName: string
  ): Promise<Connection> {
    const connectionKey = `graph:${graphName}:${graphDbUri}`;

    if (this.connections.has(connectionKey)) {
      return this.connections.get(connectionKey)!;
    }

    this.logger.debug(
      `Creating connection to graph database: ${graphDbUri} for graph: ${graphName}`
    );

    const connection = await mongoose.createConnection(graphDbUri, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4,
      bufferCommands: false,
    });

    this.connections.set(connectionKey, connection);

    this.logger.log(
      `Connected to graph database: ${graphDbUri} for graph: ${graphName}`
    );

    return connection;
  }

  /**
   * Close all connections
   */
  static async closeAllConnections(): Promise<void> {
    this.logger.debug("Closing all database connections");

    for (const [key, connection] of this.connections) {
      try {
        await connection.close();
        this.logger.debug(`Closed connection: ${key}`);
      } catch (error) {
        this.logger.error(
          `Failed to close connection ${key}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    this.connections.clear();
    this.logger.log("All database connections closed");
  }

  /**
   * Get status of all connections
   */
  static getConnectionsStatus(): Record<string, string> {
    const status: Record<string, string> = {};

    for (const [key, connection] of this.connections) {
      status[key] = this.getConnectionState(connection.readyState);
    }

    return status;
  }

  private static getConnectionState(readyState: number): string {
    switch (readyState) {
      case 0:
        return "disconnected";
      case 1:
        return "connected";
      case 2:
        return "connecting";
      case 3:
        return "disconnecting";
      default:
        return "unknown";
    }
  }
}

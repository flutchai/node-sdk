/**
 * Tool configuration types
 */

/**
 * Agent's tool configuration
 */
export interface IAgentToolConfig {
  /** Tool name from catalog */
  toolName: string;
  /** Is enabled for this agent */
  enabled: boolean;
  /** Custom configuration values */
  config?: Record<string, any>;
}

/**
 * Agent tool configuration with credential management
 */
export interface IAgentToolConfiguration {
  /** Tool name from catalog */
  toolName: string;
  /** Is enabled for this agent */
  enabled: boolean;
  /** Agent-specific configuration values */
  config?: Record<string, any>;
  /** Authentication credentials (encrypted) */
  credentials?: Record<string, string>;
  /** Use global credentials instead of agent-specific */
  useGlobalCredentials?: boolean;
}

/**
 * System-wide tool credentials (stored securely)
 */
export interface ISystemToolCredentials {
  /** Tool name */
  toolName: string;
  /** Encrypted credentials */
  credentials: Record<string, string>;
  /** Created by user ID */
  createdBy: string;
  /** Created timestamp */
  createdAt: Date;
  /** Last updated timestamp */
  updatedAt: Date;
}

/**
 * Tool execution context with resolved credentials
 */
export interface IToolExecutionContext {
  /** Tool name */
  toolName: string;
  /** Resolved configuration */
  config: Record<string, any>;
  /** Resolved credentials (decrypted) */
  credentials: Record<string, string>;
  /** Agent ID executing the tool */
  agentId: string;
  /** User ID */
  userId: string;
}

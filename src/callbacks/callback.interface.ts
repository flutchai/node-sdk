// packages/sdk/src/interfaces/callback.interface.ts

/**
 * Callback system interfaces for graph services
 */

export interface CallbackEntry {
  graphType: string;
  handler: string;
  userId: string;
  threadId?: string;
  agentId?: string;
  params: Record<string, any>;
  metadata?: {
    idempotencyKey?: string;
    scopes?: string[];
    ttlSec?: number;
    platform?: string;
    companyId?: string;
  };
}

export interface CallbackRecord extends CallbackEntry {
  token: string;
  status: "pending" | "processing" | "completed" | "expired" | "failed";
  createdAt: number;
  executedAt?: number;
  retries: number;
  lastError?: string;
}

export interface CallbackResult {
  success: boolean;
  message?: string;
  attachments?: any[];
  patch?: CallbackPatch;
  error?: string;
}

export interface CallbackPatch {
  /** New message to edit the original */
  editMessage?: string;
  /** New text for the message */
  text?: string;
  /** New keyboard */
  keyboard?: any;
  /** Disable all buttons in the original message */
  disableButtons?: boolean;
  /** Replace buttons with new ones */
  newButtons?: any[];
}

export interface CallbackContext {
  userId: string;
  threadId?: string;
  agentId?: string;
  params: Record<string, any>;
  platform?: string;
  metadata?: any;
}

export type CallbackHandler = (
  context: CallbackContext
) => Promise<CallbackResult>;

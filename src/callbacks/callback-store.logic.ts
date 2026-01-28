/**
 * Pure business logic for CallbackStore — no I/O, no DI.
 * Easily testable without mocks.
 */

import { randomBytes } from "crypto";
import { CallbackEntry, CallbackRecord } from "./callback.interface";

/**
 * Generate a unique callback token.
 * Format: cb::{graphType}::{random base64url}
 */
export function generateCallbackToken(graphType: string): string {
  return `cb::${graphType}::${randomBytes(8).toString("base64url")}`;
}

/**
 * Create an initial CallbackRecord from an entry.
 */
export function createCallbackRecord(
  entry: CallbackEntry,
  token: string,
  now: number
): CallbackRecord {
  return {
    ...entry,
    token,
    status: "pending",
    createdAt: now,
    retries: 0,
  };
}

/**
 * Resolve TTL for a callback entry (metadata.ttlSec or default 600s).
 */
export function resolveCallbackTTL(entry: CallbackEntry): number {
  return entry.metadata?.ttlSec ?? 600;
}

/**
 * Safely parse a JSON string into a CallbackRecord.
 * Returns null on parse failure.
 */
export function parseCallbackRecord(data: string): CallbackRecord | null {
  try {
    return JSON.parse(data) as CallbackRecord;
  } catch {
    return null;
  }
}

/**
 * Transition a record to "processing" status.
 */
export function markAsProcessing(record: CallbackRecord): CallbackRecord {
  return { ...record, status: "processing" };
}

/**
 * Transition a record to "failed" status, incrementing retries.
 */
export function markAsFailed(
  record: CallbackRecord,
  error: string
): CallbackRecord {
  return {
    ...record,
    status: "failed",
    retries: (record.retries || 0) + 1,
    lastError: error,
  };
}

/**
 * Transition a record to "pending" status (for retry).
 */
export function markAsPending(record: CallbackRecord): CallbackRecord {
  return { ...record, status: "pending" };
}

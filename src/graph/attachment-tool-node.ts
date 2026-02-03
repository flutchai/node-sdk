/**
 * Attachment-aware tool execution for LangGraph nodes.
 *
 * Solves the problem of large tool results (e.g. PG query → thousands of rows)
 * polluting LLM context. When a tool result exceeds the configured threshold,
 * the full data is stored in state.attachments and LLM sees only a summary.
 *
 * When a subsequent tool (e.g. pandas) needs the data, it's auto-injected
 * from state.attachments into the tool's configured data argument.
 *
 * Usage in graph builders:
 * ```typescript
 * import { executeToolWithAttachments, DEFAULT_ATTACHMENT_THRESHOLD } from "@flutchai/flutch-sdk";
 *
 * // In your executeToolsNode:
 * const result = await executeToolWithAttachments({
 *   toolCall,
 *   mcpClient: this.mcpClient,
 *   enrichedArgs,
 *   executionContext,
 *   config,
 *   attachments: state.attachments,
 *   logger: this.logger,
 *   // Optional: customize behavior
 *   threshold: 8000,
 *   injectIntoArg: "input",
 *   sourceAttachmentId: "call_abc123",
 * });
 * // result.toolMessage — ToolMessage for state.messages
 * // result.attachment — IGraphAttachment | undefined for state.attachments
 * ```
 */

import { ToolMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { IGraphAttachment, McpRuntimeHttpClient } from "../tools";
import { createGraphAttachment } from "../tools/attachment-summary";

/** Default threshold in characters. Can be overridden per-call or via env. */
export const DEFAULT_ATTACHMENT_THRESHOLD =
  Number(process.env.ATTACHMENT_THRESHOLD) || 4000;

export interface ExecuteToolWithAttachmentsParams {
  toolCall: {
    id: string;
    name: string;
    args: Record<string, any>;
  };
  mcpClient: McpRuntimeHttpClient;
  enrichedArgs: Record<string, any>;
  executionContext: Record<string, any>;
  config?: RunnableConfig;
  /** Current state.attachments — used for auto-injection */
  attachments: Record<string, IGraphAttachment>;
  logger?: {
    log: (message: any, ...args: any[]) => void;
    warn: (message: any, ...args: any[]) => void;
    debug: (message: any, ...args: any[]) => void;
  };
  /**
   * Threshold in characters for storing result as attachment.
   * Defaults to DEFAULT_ATTACHMENT_THRESHOLD (env or 4000).
   */
  threshold?: number;
  /**
   * Name of the argument to inject data into.
   * Defaults to "data". Set to different value if your tool expects
   * a different argument name (e.g., "input", "rows", "content").
   */
  injectIntoArg?: string;
  /**
   * Specific attachment ID to inject from. If not provided, injects the
   * most recent attachment. Use this when LLM explicitly references
   * a specific previous tool call.
   */
  sourceAttachmentId?: string;
}

export interface ExecuteToolWithAttachmentsResult {
  toolMessage: ToolMessage;
  /** Set if result exceeded threshold — merge into state.attachments */
  attachment?: { key: string; value: IGraphAttachment };
}

/**
 * Execute a tool with attachment support:
 * 1. Auto-inject data from attachments if tool's data arg is missing
 * 2. After execution, check result size
 * 3. If large → store as attachment, put summary in ToolMessage
 * 4. If small → normal ToolMessage
 * 5. On any error → fallback to standard behavior
 */
export async function executeToolWithAttachments(
  params: ExecuteToolWithAttachmentsParams
): Promise<ExecuteToolWithAttachmentsResult> {
  const {
    toolCall,
    mcpClient,
    enrichedArgs,
    executionContext,
    config,
    attachments,
    logger,
    threshold = DEFAULT_ATTACHMENT_THRESHOLD,
    injectIntoArg = "data",
    sourceAttachmentId,
  } = params;

  // Step 1: Auto-injection
  // If the configured data arg is missing/undefined and we have attachments — inject.
  const argsWithInjection = { ...enrichedArgs };

  try {
    if (shouldInjectData(argsWithInjection, attachments, injectIntoArg)) {
      const attachment = sourceAttachmentId
        ? attachments[sourceAttachmentId]
        : getLatestAttachment(attachments);

      if (attachment) {
        argsWithInjection[injectIntoArg] =
          typeof attachment.data === "string"
            ? attachment.data
            : JSON.stringify(attachment.data);
        logger?.debug(
          `[Attachment] Auto-injected data from attachment "${attachment.toolCallId}" into ${toolCall.name}.${injectIntoArg}`
        );
      }
    }
  } catch (e) {
    // Fallback: don't inject, proceed with original args
    logger?.warn(`[Attachment] Auto-injection failed: ${e}`);
  }

  // Step 2: Execute tool
  const { content, success, rawResult } = await mcpClient.executeToolWithEvents(
    toolCall.id,
    toolCall.name,
    argsWithInjection,
    executionContext,
    config
  );

  // Step 3: Check if result is large and should become attachment
  try {
    if (success && rawResult !== undefined && content.length > threshold) {
      const attachment = createGraphAttachment(
        rawResult,
        toolCall.name,
        toolCall.id
      );

      logger?.debug(
        `[Attachment] Stored large result (${content.length} chars) as attachment "${toolCall.id}"`
      );

      const toolMessage = new ToolMessage({
        content: attachment.summary,
        tool_call_id: toolCall.id,
        name: toolCall.name,
      });

      return {
        toolMessage,
        attachment: { key: toolCall.id, value: attachment },
      };
    }
  } catch (e) {
    // Fallback: return normal ToolMessage with full content
    logger?.warn(
      `[Attachment] Failed to create attachment, using full content: ${e}`
    );
  }

  // Step 4: Normal result (small or fallback)
  const toolMessage = new ToolMessage({
    content,
    tool_call_id: toolCall.id,
    name: toolCall.name,
  });

  return { toolMessage };
}

/**
 * Check if we should inject data from attachments.
 * Condition: configured data arg is absent or undefined (not falsy —
 * empty string, 0, false are valid user-provided values).
 */
function shouldInjectData(
  args: Record<string, any>,
  attachments: Record<string, IGraphAttachment>,
  dataArgName: string
): boolean {
  if (Object.keys(attachments).length === 0) return false;
  // Only inject when the argument is truly missing, not when it has any value
  return args[dataArgName] === undefined;
}

/** Exported for testing */
export const _internals = {
  shouldInjectData,
  getLatestAttachment,
};

/**
 * Get the most recently created attachment.
 */
function getLatestAttachment(
  attachments: Record<string, IGraphAttachment>
): IGraphAttachment | undefined {
  const entries = Object.values(attachments);
  if (entries.length === 0) return undefined;
  return entries.reduce((latest, curr) =>
    curr.createdAt > latest.createdAt ? curr : latest
  );
}

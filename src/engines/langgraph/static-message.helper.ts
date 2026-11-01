import { AIMessage } from "@langchain/core/messages";
import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";
import { LangGraphRunnableConfig } from "@langchain/langgraph";

/**
 * Creates and streams a static message from a LangGraph node.
 *
 * This helper:
 * 1. Creates an AIMessage with the provided content
 * 2. Dispatches a custom event for immediate streaming to the user
 * 3. Returns the AIMessage for the graph state
 *
 * @param content - The text content to send
 * @param config - LangGraph runnable config (required for dispatchCustomEvent)
 * @returns AIMessage containing the content
 *
 * @example
 * ```typescript
 * async execute(
 *   state: MyGraphStateValues,
 *   config: LangGraphRunnableConfig<MyConfigValues>
 * ): Promise<Partial<MyGraphStateValues>> {
 *   const answer = await createStaticMessage(
 *     "Processing complete",
 *     config
 *   );
 *
 *   return { answer };
 * }
 * ```
 */
export async function createStaticMessage(
  content: string,
  config: LangGraphRunnableConfig
): Promise<AIMessage> {
  // Create AIMessage with content
  const message = new AIMessage({
    content,
  });

  // Dispatch custom event for streaming (works with streamEvents v2)
  await dispatchCustomEvent("send_static_message", { content }, config);

  return message;
}

/**
 * Dispatches attachments (buttons, files, etc.) from a LangGraph node.
 *
 * This helper dispatches a custom event that the EventProcessor uses to
 * add attachments to the final response without duplication.
 *
 * @param attachments - Array of attachments to send
 * @param config - LangGraph runnable config (required for dispatchCustomEvent)
 *
 * @example
 * ```typescript
 * async execute(
 *   state: MyGraphStateValues,
 *   config: LangGraphRunnableConfig<MyConfigValues>
 * ): Promise<Partial<MyGraphStateValues>> {
 *   await dispatchAttachments([
 *     { type: 'button', value: { text: 'Click me', url: 'https://...' } }
 *   ], config);
 *
 *   return { answer };
 * }
 * ```
 */
export async function dispatchAttachments(
  attachments: any[],
  config: LangGraphRunnableConfig
): Promise<void> {
  // Dispatch custom event for attachments (works with streamEvents v2)
  await dispatchCustomEvent("send_attachments", { attachments }, config);
}

/**
 * Names a tool call for the client: a short line in the client's words («Studying the brand Flabelus»), shown in place
 * of the call's raw input and output. The EventProcessor sets it on the call's `tool_use` block (the block of this
 * call `id`, else the latest unlabelled block of this tool `name`) and sends a `tool_label` delta.
 *
 * @param call - The call: the id the model gave it (the block's id) and the tool's name
 * @param label - The line
 * @param config - LangGraph runnable config (required for dispatchCustomEvent)
 */
export async function dispatchToolLabel(
  call: { id?: string; name: string },
  label: string,
  config: LangGraphRunnableConfig
): Promise<void> {
  await dispatchCustomEvent(
    "tool_label",
    { id: call.id, name: call.name, label },
    config
  );
}

/**
 * Changes an attachment the graph sent earlier (one with an `id`): a list of steps that get done, a card whose loader
 * stops. The EventProcessor merges `patch.value` into the attachment's `value` and `patch.metadata` into its metadata
 * (one level deep: a key given replaces that key) and sends an `attachment_updated` delta. An attachment it does not
 * hold is left alone (the host changes a saved one).
 */
export async function dispatchAttachmentUpdate(
  id: string,
  patch: {
    value?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
  config: LangGraphRunnableConfig
): Promise<void> {
  await dispatchCustomEvent("update_attachment", { id, patch }, config);
}

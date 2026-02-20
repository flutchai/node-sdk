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

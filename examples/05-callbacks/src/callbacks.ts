import {
  Callback,
  CallbackContext,
  CallbackResult,
} from "@flutchai/flutch-sdk";

/**
 * Callbacks for the order processing workflow
 * These are invoked when users interact with buttons/actions in the UI
 */
export class OrderCallbacks {
  /**
   * Handle order approval
   */
  @Callback("approve-order")
  async handleApproveOrder(context: CallbackContext): Promise<CallbackResult> {
    const orderId = context.params?.orderId;
    const userId = context.userId;

    console.log(`Order ${orderId} approved by user ${userId}`);

    // In a real app, you would update the database here
    return {
      success: true,
      message: `Order #${orderId} has been approved! Status: approved, Approved by: ${userId}, At: ${new Date().toISOString()}`,
    };
  }

  /**
   * Handle order rejection
   */
  @Callback("reject-order")
  async handleRejectOrder(context: CallbackContext): Promise<CallbackResult> {
    const orderId = context.params?.orderId;
    const reason = context.params?.reason || "No reason provided";
    const userId = context.userId;

    console.log(`Order ${orderId} rejected by user ${userId}: ${reason}`);

    return {
      success: true,
      message: `Order #${orderId} has been rejected. Reason: ${reason}`,
    };
  }

  /**
   * Handle request for more information
   */
  @Callback("request-info")
  async handleRequestInfo(context: CallbackContext): Promise<CallbackResult> {
    const orderId = context.params?.orderId;
    const infoType = context.params?.infoType || "general";

    console.log(`More info requested for order ${orderId}, type: ${infoType}`);

    return {
      success: true,
      message: `Additional information requested for Order #${orderId}. Info type: ${infoType}`,
    };
  }
}

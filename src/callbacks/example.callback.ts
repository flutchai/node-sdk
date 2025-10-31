import { CallbackResult } from "../interfaces/callback.interface";
import { CallbackRegistry } from "./callback-registry";

/**
 * Example finance callback registration demonstrating how graph-specific
 * handlers can integrate with the universal callback system.
 */
export function registerFinanceExampleCallback(registry: CallbackRegistry) {
  registry.register(
    "example",
    async (): Promise<CallbackResult> => ({
      success: true,
      message: "Finance callback executed",
    }),
    "finance::1.0.0" // Optional graph type for versioning
  );
}

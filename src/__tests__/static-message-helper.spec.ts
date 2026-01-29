import { AIMessage } from "@langchain/core/messages";
import { createStaticMessage } from "../engines/langgraph/static-message.helper";

// Mock dispatchCustomEvent
jest.mock("@langchain/core/callbacks/dispatch", () => ({
  dispatchCustomEvent: jest.fn().mockResolvedValue(undefined),
}));

import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";

describe("createStaticMessage", () => {
  const mockConfig = { configurable: { thread_id: "t-1" } } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return an AIMessage with the provided content", async () => {
    const result = await createStaticMessage("Hello world", mockConfig);

    expect(result).toBeInstanceOf(AIMessage);
    expect(result.content).toBe("Hello world");
  });

  it("should dispatch send_static_message custom event", async () => {
    await createStaticMessage("Test content", mockConfig);

    expect(dispatchCustomEvent).toHaveBeenCalledWith(
      "send_static_message",
      { content: "Test content" },
      mockConfig
    );
  });

  it("should dispatch event before returning", async () => {
    const result = await createStaticMessage("Order matters", mockConfig);

    expect(dispatchCustomEvent).toHaveBeenCalledTimes(1);
    expect(result.content).toBe("Order matters");
  });
});

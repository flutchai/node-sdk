import { CallbackPatchService } from "../callbacks/callback-patch.service";

describe("CallbackPatchService", () => {
  const mockTelegram = { apply: jest.fn() };
  const mockWeb = { apply: jest.fn() };
  let service: CallbackPatchService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CallbackPatchService(mockTelegram as any, mockWeb as any);
  });

  const makeRecord = (platform?: string) => ({
    token: "tok_1",
    graphType: "chat",
    handler: "confirm",
    userId: "u1",
    createdAt: Date.now(),
    retries: 0,
    status: "pending",
    metadata: platform ? { platform } : {},
  });

  it("should delegate to telegram handler for telegram platform", async () => {
    const patch = { action: "edit_message" };
    await service.apply(makeRecord("telegram") as any, patch as any);

    expect(mockTelegram.apply).toHaveBeenCalledWith(patch, undefined);
    expect(mockWeb.apply).not.toHaveBeenCalled();
  });

  it("should delegate to web handler for web platform", async () => {
    const patch = { action: "update" };
    await service.apply(makeRecord("web") as any, patch as any);

    expect(mockWeb.apply).toHaveBeenCalledWith(patch, undefined);
    expect(mockTelegram.apply).not.toHaveBeenCalled();
  });

  it("should pass context to handler", async () => {
    const patch = { action: "edit" };
    const ctx = { chatId: 123 };
    await service.apply(makeRecord("telegram") as any, patch as any, ctx);

    expect(mockTelegram.apply).toHaveBeenCalledWith(patch, ctx);
  });

  it("should do nothing for unsupported platform", async () => {
    await service.apply(makeRecord("discord") as any, { action: "x" } as any);

    expect(mockTelegram.apply).not.toHaveBeenCalled();
    expect(mockWeb.apply).not.toHaveBeenCalled();
  });

  it("should return early if patch is null/undefined", async () => {
    await service.apply(makeRecord("telegram") as any, null as any);

    expect(mockTelegram.apply).not.toHaveBeenCalled();
  });

  it("should catch and log handler errors without throwing", async () => {
    mockTelegram.apply.mockRejectedValue(new Error("telegram API error"));

    await expect(
      service.apply(makeRecord("telegram") as any, { action: "edit" } as any)
    ).resolves.toBeUndefined();
  });

  it("should handle non-Error thrown values", async () => {
    mockWeb.apply.mockRejectedValue("string error");

    await expect(
      service.apply(makeRecord("web") as any, { action: "edit" } as any)
    ).resolves.toBeUndefined();
  });
});

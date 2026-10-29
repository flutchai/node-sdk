import { request } from "http";
import { INestApplication, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { GraphController } from "../graph/graph.controller";
import { BuilderRegistryService } from "../core/builder-registry.service";

const service = {
  generateAnswer: jest.fn(),
  streamAnswer: jest.fn(),
  cancelGeneration: jest.fn(async () => undefined),
};

@Module({
  controllers: [GraphController],
  providers: [
    { provide: "GRAPH_SERVICE", useValue: service },
    { provide: BuilderRegistryService, useValue: {} },
  ],
})
class GraphControllerTestModule {}

/** POSTs a run; `hangUpAfterMs` drops the connection before the answer, as a caller that timed out does. */
function post(
  port: number,
  path: string,
  hangUpAfterMs?: number
): Promise<void> {
  return new Promise(resolve => {
    const body = JSON.stringify({ requestId: "req-1" });
    const req = request(
      {
        port,
        path,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      res => {
        res.resume();
        res.on("end", () => resolve());
      }
    );
    req.on("error", () => resolve());
    req.end(body);
    if (hangUpAfterMs !== undefined)
      setTimeout(() => (req.destroy(), resolve()), hangUpAfterMs);
  });
}

const until = async (check: () => boolean, ms = 1000) => {
  for (const start = Date.now(); !check() && Date.now() - start < ms; )
    await new Promise(r => setTimeout(r, 10));
};

describe("GraphController — cancel on disconnect", () => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    app = await NestFactory.create(GraphControllerTestModule, {
      logger: false,
    });
    await app.listen(0);
    port = Number(new URL(await app.getUrl()).port);
  });

  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it("cancels a run whose caller hung up before the answer", async () => {
    service.streamAnswer.mockImplementation(
      () =>
        new Promise(resolve => setTimeout(() => resolve({ text: "late" }), 300))
    );

    await post(port, "/stream", 50);
    await until(() => service.cancelGeneration.mock.calls.length > 0);

    expect(service.cancelGeneration).toHaveBeenCalledWith("req-1");
  });

  it("leaves a run alone once its answer went out", async () => {
    service.generateAnswer.mockResolvedValue({ text: "done" });
    service.streamAnswer.mockResolvedValue({ text: "done" });

    await post(port, "/generate");
    await post(port, "/stream");
    await new Promise(r => setTimeout(r, 50));

    expect(service.cancelGeneration).not.toHaveBeenCalled();
  });
});

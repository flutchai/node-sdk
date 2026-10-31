// packages/sdk/src/api/graph.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  Res,
  HttpStatus,
  HttpException,
  Inject,
  Logger,
  Query,
  Param,
} from "@nestjs/common";
import { Response } from "express";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiParam,
} from "@nestjs/swagger";
import type {
  IGraphRequestPayload,
  IGraphResponsePayload,
  IGraphService,
} from "./graph-service.interface";
import { BuilderRegistryService } from "../core/builder-registry.service";

/**
 * Unified controller for Graph API
 * Includes core graph operations and registry
 */
@ApiTags("Graphs")
@Controller()
export class GraphController {
  protected readonly logger = new Logger(GraphController.name);

  constructor(
    @Inject("GRAPH_SERVICE")
    protected readonly graphService: IGraphService,
    @Inject(BuilderRegistryService)
    private readonly builderRegistry: BuilderRegistryService
  ) {}

  // ========== Core Graph Operations ==========

  @Get("health")
  @ApiOperation({ summary: "Check graph service health" })
  @ApiResponse({ status: 200, description: "Service is available" })
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    try {
      const isHealthy = await this.graphService.healthCheck();
      return {
        status: isHealthy ? "healthy" : "unhealthy",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Health check failed: ${error.message}`);
      throw new HttpException(
        "Service unhealthy",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  @Get("graph-types")
  @ApiOperation({ summary: "Get supported graph types" })
  @ApiResponse({ status: 200, description: "List of graph types" })
  async getSupportedGraphTypes(): Promise<string[]> {
    return this.graphService.getSupportedGraphTypes();
  }

  @Post("generate")
  @ApiOperation({ summary: "Generate answer (non-streaming)" })
  @ApiResponse({ status: 200, description: "Answer generated" })
  async generateAnswer(
    @Body() payload: IGraphRequestPayload,
    @Res() res: Response
  ): Promise<void> {
    this.cancelOnDisconnect(res, payload.requestId);
    // A run that takes longer than a heartbeat sends its headers and then a
    // space each beat, so the caller's idle timeout sees a live connection;
    // JSON.parse skips the leading whitespace. Its status is then sent, so an
    // error after that goes out as the body { statusCode, message }.
    let beating = false;
    const stop = this.heartbeat(() => {
      if (!beating) {
        res
          .status(HttpStatus.CREATED)
          .setHeader("Content-Type", "application/json");
        beating = true;
      }
      res.write(" ");
    });
    try {
      const result = await this.graphService.generateAnswer(payload);
      stop();
      if (beating) res.end(JSON.stringify(result));
      else res.status(HttpStatus.CREATED).json(result);
    } catch (error) {
      stop();
      this.logger.error(`Generation failed: ${error.message}`);
      const failure = {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: `Generation failed: ${error.message}`,
      };
      if (beating) res.end(JSON.stringify(failure));
      else res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(failure);
    }
  }

  @Post("stream")
  @ApiOperation({ summary: "Stream answer generation" })
  @ApiResponse({ status: 200, description: "Streaming response" })
  async streamAnswer(
    @Body() payload: IGraphRequestPayload,
    @Res() res: Response
  ): Promise<void> {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    this.cancelOnDisconnect(res, payload.requestId);
    // An SSE comment each beat: the caller's idle timeout sees a live run even
    // while the graph waits silently for the agents it called; clients skip it.
    const stop = this.heartbeat(() => res.write(": ping\n\n"));

    try {
      this.logger.debug(
        `[CONTROLLER] Starting streamAnswer for requestId: ${payload.requestId}`
      );

      const result = await this.graphService.streamAnswer(
        payload,
        (chunk: string) => {
          // this.logger.debug(`[CONTROLLER] Sending chunk: ${chunk}`);
          res.write(`event: stream_event\n`);
          res.write(`data: ${chunk}\n\n`);
        }
      );

      this.logger.debug(
        `[CONTROLLER] Got final result: ${JSON.stringify(result)}...`
      );

      this.logger.debug(`[CONTROLLER] Final result details:`, {
        hasText: !!result.text,
        textLength: result.text?.length || 0,
        attachmentsCount: result.attachments?.length || 0,
        reasoningChainsCount: result.reasoningChains?.length || 0,
        resultKeys: Object.keys(result || {}),
      });

      stop();
      // Send final result as SSE event
      res.write(`event: final\n`);
      res.write(`data: ${JSON.stringify(result)}\n\n`);
      res.end();

      this.logger.debug(`[CONTROLLER] Stream completed successfully`);
    } catch (error) {
      stop();
      this.logger.error(`[CONTROLLER] Streaming failed: ${error.message}`);
      this.logger.error(`[CONTROLLER] Error stack: ${error.stack}`);
      // Send error as SSE event
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ message: error.message })}\n\n`);
      res.end();
    }
  }

  /**
   * Calls `beat` every GRAPH_HEARTBEAT_MS (20 s by default, 0 turns it off)
   * while a run goes on; returns the function that stops it. A caller drops a
   * connection that stays silent past its idle limit — the backend's is
   * GRAPH_SERVICE_TIMEOUT_MS — and a graph waiting on other agents is silent
   * for minutes: a report pipeline was cut at 15 minutes, 21 seconds before
   * its report was done (29.10.2026).
   */
  private heartbeat(beat: () => void): () => void {
    const ms = Number(process.env.GRAPH_HEARTBEAT_MS ?? 20000);
    if (!(ms > 0)) return () => undefined;
    const timer = setInterval(beat, ms);
    return () => clearInterval(timer);
  }

  /**
   * A caller that hangs up before the answer is done — its own timeout, a
   * restart, a cancelled parent run — no longer waits for it, so the run is
   * cancelled: left going, it keeps calling models and tools nobody reads.
   */
  private cancelOnDisconnect(res: Response, requestId?: string): void {
    if (!requestId) return;
    res.on("close", () => {
      if (res.writableFinished) return;
      this.logger.warn(
        `[CONTROLLER] Caller disconnected before the answer: cancelling ${requestId}`
      );
      this.graphService
        .cancelGeneration(requestId)
        .catch(error =>
          this.logger.warn(
            `[CONTROLLER] Cancel after disconnect failed for ${requestId}: ${error.message}`
          )
        );
    });
  }

  @Post("cancel/:requestId")
  @ApiOperation({ summary: "Cancel generation" })
  @ApiParam({ name: "requestId", description: "Request ID to cancel" })
  @ApiResponse({ status: 200, description: "Generation cancelled" })
  async cancelGeneration(
    @Param("requestId") requestId: string
  ): Promise<{ message: string }> {
    try {
      await this.graphService.cancelGeneration(requestId);
      return { message: `Generation ${requestId} cancelled` };
    } catch (error) {
      this.logger.error(`Cancellation failed: ${error.message}`);
      throw new HttpException(
        `Cancellation failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  // ========== Graph Registry ==========

  @Get("registry")
  @ApiOperation({ summary: "Get all registered graphs" })
  @ApiResponse({ status: 200, description: "List of registered graphs" })
  async getRegisteredGraphs(): Promise<{
    total: number;
    graphs: Array<{ graphType: string; builderName: string }>;
  }> {
    const builders = this.builderRegistry.getBuilders();
    return {
      total: builders.length,
      graphs: builders.map(builder => ({
        graphType: builder.graphType,
        builderName: builder.constructor.name,
      })),
    };
  }

  @Get("registry/stats")
  @ApiOperation({ summary: "Graph registry statistics" })
  @ApiResponse({ status: 200, description: "Statistics" })
  async getRegistryStats(): Promise<{
    totalBuilders: number;
    graphTypes: string[];
    builderTypes: Record<string, number>;
  }> {
    const builders = this.builderRegistry.getBuilders();
    const graphTypes = builders.map(b => b.graphType);
    const builderTypes: Record<string, number> = {};

    builders.forEach(builder => {
      const name = builder.constructor.name;
      builderTypes[name] = (builderTypes[name] || 0) + 1;
    });

    return {
      totalBuilders: builders.length,
      graphTypes,
      builderTypes,
    };
  }
}

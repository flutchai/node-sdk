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
import {
  IGraphRequestPayload,
  IGraphResponsePayload,
  IGraphService,
} from "../interfaces";
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
    @Body() payload: IGraphRequestPayload
  ): Promise<IGraphResponsePayload> {
    try {
      return await this.graphService.generateAnswer(payload);
    } catch (error) {
      this.logger.error(`Generation failed: ${error.message}`);
      throw new HttpException(
        `Generation failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
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

      // Send final result as SSE event
      res.write(`event: final\n`);
      res.write(`data: ${JSON.stringify(result)}\n\n`);
      res.end();

      this.logger.debug(`[CONTROLLER] Stream completed successfully`);
    } catch (error) {
      this.logger.error(`[CONTROLLER] Streaming failed: ${error.message}`);
      this.logger.error(`[CONTROLLER] Error stack: ${error.stack}`);
      // Send error as SSE event
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ message: error.message })}\n\n`);
      res.end();
    }
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

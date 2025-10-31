import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Headers,
  Logger,
  NotFoundException,
  InternalServerErrorException,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { EndpointRegistry, RequestContext } from "../endpoint-registry";
import { BuilderRegistryService } from "../core/builder-registry.service";

export interface UIDispatchDto {
  graphType: string;
  endpoint: string;
  method: "GET" | "POST";
  data?: any;
  context: {
    userId: string;
    companyId?: string;
    channel?: string;
    platform?: string;
  };
}

export interface DataEnvelope<T = any> {
  schema: string;
  data: T;
  meta?: {
    total?: number;
    page?: number;
    redirect?: string;
    message?: string;
  };
}

/**
 * Controller for UI endpoint dispatch
 * Handles requests from backend to graph UI endpoints
 */
@ApiTags("UI Dispatch")
@Controller("api/graph")
export class UIDispatchController {
  private readonly logger = new Logger(UIDispatchController.name);

  constructor(
    private readonly endpointRegistry: EndpointRegistry,
    private readonly builderRegistry: BuilderRegistryService
  ) {}

  /**
   * Dispatch a request to a UI endpoint
   * Similar to callback dispatch but for synchronous UI operations
   */
  @Post("ui/dispatch")
  @ApiOperation({ summary: "Dispatch request to UI endpoint" })
  @ApiResponse({
    status: 200,
    description: "Successfully dispatched to endpoint",
  })
  @ApiResponse({ status: 404, description: "Endpoint not found" })
  async dispatchUIEndpoint(@Body() dto: UIDispatchDto): Promise<DataEnvelope> {
    this.logger.debug(
      `Dispatching UI request to ${dto.graphType}:${dto.endpoint}`
    );

    this.logger.debug("UIDispatchController received request", {
      graphType: dto.graphType,
      endpoint: dto.endpoint,
      method: dto.method,
      data: dto.data,
      context: dto.context,
    });

    try {
      // Build request context
      const context: RequestContext = {
        userId: dto.context.userId,
        companyId: dto.context.companyId,
        method: dto.method,
        payload: dto.data,
        channel: dto.context.channel || "web",
        platform: dto.context.platform,
      };

      this.logger.debug("Built RequestContext", context);

      // Call the endpoint through registry
      const result = await this.endpointRegistry.call(
        dto.graphType,
        dto.endpoint,
        context
      );

      this.logger.debug(
        `Successfully dispatched to ${dto.graphType}:${dto.endpoint}`
      );

      return result;
    } catch (error: any) {
      this.logger.error(
        `Failed to dispatch to ${dto.graphType}:${dto.endpoint}:`,
        error.message
      );

      if (error.message.includes("not found")) {
        throw new NotFoundException(error.message);
      }

      throw new InternalServerErrorException(
        `Failed to dispatch: ${error.message}`
      );
    }
  }

  /**
   * Get manifest for a graph type
   * Returns the graph configuration including UI section
   */
  @Get(":graphType/manifest")
  @ApiOperation({ summary: "Get graph manifest with UI configuration" })
  @ApiResponse({ status: 200, description: "Graph manifest" })
  @ApiResponse({ status: 404, description: "Graph not found" })
  async getGraphManifest(
    @Param("graphType") graphType: string,
    @Headers("x-user-id") userId: string
  ): Promise<any> {
    this.logger.debug(`Fetching manifest for graph ${graphType}`);

    try {
      // Get builder from registry
      const builder = this.builderRegistry
        .getBuilders()
        .find(b => b.graphType === graphType);

      if (!builder) {
        throw new NotFoundException(`Graph ${graphType} not found in registry`);
      }

      // Get manifest from builder (it's already loaded from graph.manifest.json)
      const manifest = (builder as any).manifest;

      if (!manifest) {
        this.logger.warn(
          `Builder for ${graphType} exists but has no manifest loaded`
        );
        // Fallback: return basic manifest
        return {
          graphType,
          name: graphType,
          version: builder.version,
          ui: {
            enabled: false,
          },
        };
      }

      this.logger.debug(
        `Found manifest for ${graphType} with UI enabled: ${!!manifest.ui?.enabled}`
      );

      return manifest;
    } catch (error: any) {
      this.logger.error(
        `Failed to get manifest for ${graphType}:`,
        error.message
      );
      throw new NotFoundException(`Graph ${graphType} not found`);
    }
  }

  /**
   * List all available UI endpoints for a graph
   * Useful for debugging and discovery
   */
  @Get(":graphType/endpoints")
  @ApiOperation({ summary: "List UI endpoints for a graph" })
  @ApiResponse({
    status: 200,
    description: "List of endpoint names",
    type: [String],
  })
  async listEndpoints(
    @Param("graphType") graphType: string,
    @Headers("x-user-id") userId: string
  ): Promise<string[]> {
    this.logger.debug(`Listing endpoints for graph ${graphType}`);

    try {
      const endpoints = this.endpointRegistry.listEndpoints(graphType);

      this.logger.debug(`Found ${endpoints.length} endpoints for ${graphType}`);

      return endpoints;
    } catch (error: any) {
      this.logger.error(
        `Failed to list endpoints for ${graphType}:`,
        error.message
      );
      return [];
    }
  }

  /**
   * Get catalog of all graphs
   * Returns basic info about all registered graphs
   */
  @Get("catalog")
  @ApiOperation({ summary: "Get catalog of all graphs" })
  @ApiResponse({
    status: 200,
    description: "List of graphs with basic info",
  })
  async getGraphCatalog(
    @Headers("x-user-id") userId: string,
    @Headers("x-company-id") companyId?: string
  ): Promise<any[]> {
    this.logger.debug("Fetching graph catalog");

    try {
      // Get all registered graph types
      const graphTypes = this.endpointRegistry.listGraphTypes();

      // Build catalog with basic info
      const catalog = graphTypes.map(graphType => ({
        graphType,
        name: graphType,
        ui: {
          enabled: this.endpointRegistry.listEndpoints(graphType).length > 0,
        },
      }));

      this.logger.debug(`Returning catalog with ${catalog.length} graphs`);

      return catalog;
    } catch (error: any) {
      this.logger.error("Failed to get graph catalog:", error.message);
      return [];
    }
  }
}

# @flutchai/flutch-sdk

Base infrastructure package for building graph microservices with LangGraph and NestJS.

## Overview

`@flutchai/flutch-sdk` is a self-contained foundation package that **turns your graph logic into a production-ready microservice**. Write your graph builder, and the SDK handles everything else: REST API, streaming, health checks, metrics, callbacks, and versioning.

The SDK is designed to be **framework-agnostic** - while it currently provides first-class support for LangGraph.js with NestJS, the architecture allows for supporting other graph frameworks (LlamaIndex, custom implementations, etc.) in the future.

## What's Included

### Core Components

- **UniversalGraphModule** - NestJS module for bootstrapping graph services
- **AbstractGraphBuilder** - Base class for implementing graph builders
- **GraphController** - REST API controller with standard endpoints
- **CallbackController** - Callback system for interactive flows

### Interfaces & Types

- **IGraphService** - Standard interface for all graph services
- **IGraphRequestPayload** / **IGraphResponsePayload** - Request/response contracts
- **IGraphRunnableConfig** - Graph execution configuration
- **CallbackRecord** / **CallbackResult** - Callback system types
- **Graph type registry** - Type-safe graph definitions

### Engine Components

- **LangGraphEngine** - LangGraph.js integration
- **EventProcessor** - Stream event processing with metrics collection
- **ApiCallTracer** - API call tracing and sanitization utilities

### Validation & Schemas

- **GraphManifestSchema** - JSON Schema for graph manifests
- **GraphManifestValidator** - Manifest validation utilities

### Utilities

- **GraphTypeUtils** - Version parsing and normalization
  - Parse: `global.simple::1.2.0` → `{ companyId, name, version }`
  - Build: `build("global", "simple", "1.2.0")` → `global.simple::1.2.0`
  - Normalize: Handle legacy formats

### Callback System

Complete callback infrastructure for interactive user flows:

- Token-based callback registration
- ACL and security checks
- Idempotency management
- Platform-specific handlers (Web, Telegram)
- Audit logging

## Installation

```bash
npm install @flutchai/flutch-sdk
```

or

```bash
yarn add @flutchai/flutch-sdk
```

## Quick Start

The SDK provides everything you need to quickly launch a production-ready graph service. With minimal setup, you get a fully functional NestJS application with REST API, health checks, metrics, and more.

### 1. Create Your Graph Builder

```typescript
import { Injectable } from "@nestjs/common";
import { AbstractGraphBuilder } from "@flutchai/flutch-sdk";
import { StateGraph, START, END } from "@langchain/langgraph";

@Injectable()
export class MyGraphBuilder extends AbstractGraphBuilder<"myGraph"> {
  async buildGraph(config?: any): Promise<CompiledGraphFor<"myGraph">> {
    // Define your graph logic
    const graph = new StateGraph(MyState)
      .addNode("process", async state => {
        // Your processing logic
        return { result: "processed" };
      })
      .addEdge(START, "process")
      .addEdge("process", END)
      .compile();

    return graph;
  }
}
```

### 2. Register the Module

```typescript
import { Module } from "@nestjs/common";
import { UniversalGraphModule } from "@flutchai/flutch-sdk";

@Module({
  imports: [
    UniversalGraphModule.register({
      graphType: "myGraph",
      builder: MyGraphBuilder,
    }),
  ],
})
export class AppModule {}
```

### 3. Bootstrap Your Application

```typescript
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
```

That's it! Your graph service is now running with a complete REST API.

## What You Get Out of the Box

Once your service is running, you automatically get:

### REST API Endpoints

The SDK provides ready-to-use controllers with standard endpoints:

#### Graph Execution (`GraphController`)

- `GET /health` - Service health check
- `GET /graph-types` - List supported graph types
- `POST /generate` - Non-streaming generation
- `POST /stream` - Server-Sent Events (SSE) streaming
- `POST /cancel/:requestId` - Cancel running generation
- `GET /registry` - View registered graphs
- `GET /registry/stats` - Registry statistics

#### Callbacks (`CallbackController`)

- `POST /callback` - Handle user callbacks with token-based security

#### UI Dispatch (`UIDispatchController`)

- `POST /api/graph/ui/dispatch` - Dispatch requests to custom UI endpoints
- `GET /api/graph/:graphType/manifest` - Get graph manifest with UI config
- `GET /api/graph/:graphType/endpoints` - List available UI endpoints
- `GET /api/graph/catalog` - Get catalog of all graphs

### Monitoring & Observability

- Prometheus metrics at `/metrics`
- Health checks with `@nestjs/terminus`
- Request/response logging
- API call tracing with sanitization

### Production Features

- Helmet security headers
- Compression middleware
- Redis-backed callback system
- OpenAPI/Swagger documentation
- Error handling and validation

## API Usage Examples

### Non-Streaming Generation

```bash
curl -X POST http://localhost:3000/generate \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-123",
    "graphType": "myGraph",
    "messages": [
      { "role": "user", "content": "Hello!" }
    ]
  }'
```

### Streaming Generation (SSE)

```bash
curl -X POST http://localhost:3000/stream \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-456",
    "graphType": "myGraph",
    "messages": [
      { "role": "user", "content": "Tell me a story" }
    ]
  }'
```

The stream returns Server-Sent Events:

```
event: stream_event
data: {"type":"chunk","content":"Once upon"}

event: stream_event
data: {"type":"chunk","content":" a time"}

event: final
data: {"text":"Once upon a time...","attachments":[],"metadata":{}}
```

### Check Health

```bash
curl http://localhost:3000/health
# Response: {"status":"healthy","timestamp":"2025-11-03T12:00:00.000Z"}
```

### View Registered Graphs

```bash
curl http://localhost:3000/registry
# Response: {"total":1,"graphs":[{"graphType":"myGraph","builderName":"MyGraphBuilder"}]}
```

## Advanced Usage

### Using GraphTypeUtils

```typescript
import { GraphTypeUtils } from "@flutchai/flutch-sdk";

// Parse versioned graph types
const parsed = GraphTypeUtils.parse("global.simple::1.2.0");
// → { companyId: "global", name: "simple", version: "1.2.0" }

// Build graph type string
const fullType = GraphTypeUtils.build("company-123", "customRag", "2.0.0");
// → "company-123.customRag::2.0.0"

// Normalize legacy formats
const normalized = GraphTypeUtils.normalize("simple");
// → "global.simple"

// Extract version
const version = GraphTypeUtils.getVersion("global.rag::1.5.0");
// → "1.5.0"
```

### Validating Graph Manifests

```typescript
import { GraphManifestValidator } from "@flutchai/flutch-sdk";

const manifest = {
  graphType: "myGraph",
  title: "My Custom Graph",
  description: "Does cool things",
  // ... other fields
};

// Validate and get result
const result = GraphManifestValidator.validate(manifest);
if (!result.isValid) {
  console.error(result.errors);
}

// Or throw on invalid
GraphManifestValidator.validateOrThrow(manifest);
```

### Processing Stream Events

```typescript
import { EventProcessor, StreamAccumulator } from "@flutchai/flutch-sdk";

@Injectable()
export class MyService {
  constructor(private eventProcessor: EventProcessor) {}

  async processStream(stream: any): Promise<IGraphResponsePayload> {
    const accumulator = this.eventProcessor.createAccumulator();

    for await (const event of stream) {
      this.eventProcessor.processEvent(
        accumulator,
        event,
        chunk => console.log(chunk) // Partial callback
      );
    }

    return this.eventProcessor.getResult(accumulator);
  }
}
```

## Architecture

### Package Structure

```
src/
├── api/              # REST controllers and guards
├── bootstrap.ts      # Service bootstrap utilities
├── callbacks/        # Callback system implementation
├── core/             # Core modules and builders
├── decorators/       # Custom decorators
├── endpoint-registry # Endpoint registration
├── engine/           # Graph execution engines
├── interfaces/       # TypeScript interfaces
├── schemas/          # JSON schemas
├── types/            # TypeScript type definitions
├── utils/            # Utility functions
└── versioning/       # Version management
```

### Dependencies

The package has no internal dependencies and relies only on well-established external libraries:

- `@nestjs/*` - NestJS framework for building scalable server-side applications
- `@langchain/*` - LangChain ecosystem for LLM integrations and graph orchestration
- `ioredis` - Redis client for callback system and caching
- `axios` - HTTP client for external API calls
- `zod` - TypeScript-first schema validation
- `helmet`, `compression` - HTTP security and performance middleware

### Design Principles

1. **Self-contained** - No internal dependencies, everything you need in one package
2. **Type-safe** - Comprehensive TypeScript definitions for all components
3. **Modular** - Use only what you need, import specific modules
4. **Production-ready** - Built-in monitoring, health checks, and error handling
5. **Framework integration** - Seamless NestJS integration with LangGraph

## Quick Start

```typescript
import {
  UniversalGraphModule,
  AbstractGraphBuilder,
} from "@flutchai/flutch-sdk";
import { Module } from "@nestjs/common";

@Injectable()
export class MyGraphBuilder extends AbstractGraphBuilder<"myGraph"> {
  async buildGraph(config?: any) {
    // Your LangGraph implementation
    return compiledGraph;
  }
}

@Module({
  imports: [
    UniversalGraphModule.register({
      graphType: "myGraph",
      builder: MyGraphBuilder,
    }),
  ],
})
export class MyGraphModule {}
```

Your graph service is now ready with built-in REST API, health checks, and monitoring!

## API

### Main Exports

```typescript
// Core
export { UniversalGraphModule, AbstractGraphBuilder };

// Interfaces
export {
  IGraphService,
  IGraphRequestPayload,
  IGraphResponsePayload,
  CallbackRecord,
  CallbackResult,
};

// Engine
export { LangGraphEngine, EventProcessor, ApiCallTracer };

// Utilities
export { GraphTypeUtils, GraphManifestValidator };

// Types
export { IGraphTypeRegistry, CompiledGraphFor, BaseGraphState };
```

See `src/index.ts` for complete export list.

## Development

### Building

```bash
npm run build
```

### Testing

```bash
npm test
```

### Linting

```bash
npm run lint
```

## Features

- **Ready-to-use NestJS module** for graph services
- **Type-safe graph definitions** with TypeScript
- **Built-in REST API** with OpenAPI documentation
- **Callback system** for interactive user flows
- **Stream processing** with real-time events
- **Health checks** and Prometheus metrics
- **Redis integration** for callbacks and caching
- **Multi-LLM support** (OpenAI, Anthropic, Azure, Google, Mistral, Cohere)
- **Graph versioning** utilities
- **Manifest validation** for graph configurations

## Flutch Platform Integration

The SDK is designed to seamlessly integrate with the **Flutch Platform**, giving you enterprise-grade capabilities out of the box:

### One-Line Platform Connection

```typescript
UniversalGraphModule.register({
  graphType: "myGraph",
  builder: MyGraphBuilder,
  flutch: {
    apiKey: process.env.FLUTCH_API_KEY,
    endpoint: "https://api.flutch.ai",
  },
});
```

### What You Get with Flutch Platform

**Tracing & Analytics**

- Distributed tracing across all graph executions
- Performance metrics and bottleneck detection
- Cost analytics per request and model
- Token usage tracking

**Multi-Channel UI**

- Web, Telegram, Slack, WhatsApp support
- Unified UI components across channels
- Channel-specific adaptations
- Custom branding

**Governance & Control**

- Rate limiting and quota management
- User-level and company-level limits
- Budget controls and alerts
- Usage analytics

**Testing & Quality**

- A/B testing for graph versions
- Acceptance testing automation
- AI-powered test generation
- Regression testing

**Run Standalone or with Platform**

The SDK works perfectly standalone for self-hosted deployments, or connect to Flutch Platform for advanced features. Your choice.

## Key Benefits

### Instant Service Deployment

Go from graph logic to deployed microservice in minutes. No need to build REST APIs, implement streaming, or set up monitoring - it's all included.

### Graph Versioning

Built-in support for versioning your graphs. Run multiple versions simultaneously, test new versions, and roll back safely.

### Framework Flexibility

Currently supports LangGraph.js. The architecture is designed to support other graph frameworks like LlamaIndex, ensuring your investment is future-proof.

### Developer Experience

- Type-safe graph definitions with TypeScript
- Hot reload during development
- OpenAPI/Swagger documentation auto-generated
- Comprehensive error handling

### Interactive Capabilities

- **Callbacks**: Add interactive buttons and user interactions to your graphs
- **UI Endpoints**: Create custom UI endpoints for dynamic interfaces
- **Streaming**: Real-time responses with Server-Sent Events

### Production Ready

- Prometheus metrics for monitoring
- Health checks for orchestration
- Redis-backed state management
- Security headers and compression

## Use Cases

- **AI Agent Microservices**: Deploy autonomous agents as scalable services
- **Conversational AI**: Build chatbots and virtual assistants
- **RAG Systems**: Implement retrieval-augmented generation workflows
- **Multi-step Workflows**: Orchestrate complex AI pipelines
- **Interactive Assistants**: Create agents with callbacks and dynamic UIs

## Links

- [GitHub Repository](https://github.com/flutchai/node-sdk)
- [NPM Package](https://www.npmjs.com/package/@flutchai/flutch-sdk)
- [Issues](https://github.com/flutchai/node-sdk/issues)

## License

MIT

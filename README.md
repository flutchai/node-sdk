# @flutchai/flutch-sdk

Base infrastructure package for building graph microservices with LangGraph and NestJS.

## Overview

`@flutchai/flutch-sdk` is a self-contained foundation package that provides all the essential components needed to build, run, and manage LangGraph-based microservices using NestJS framework.

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

## Usage

### Creating a Graph Service

```typescript
import {
  UniversalGraphModule,
  AbstractGraphBuilder,
  IGraphRunnableConfig,
} from "@flutchai/flutch-sdk";

@Injectable()
export class MyGraphBuilder extends AbstractGraphBuilder<"myGraph"> {
  async buildGraph(config?: any): Promise<CompiledGraphFor<"myGraph">> {
    // Build your LangGraph here
    return compiledGraph;
  }
}

@Module({
  imports: [
    UniversalGraphModule.register({
      graphType: "myGraph",
      builder: MyGraphBuilder,
      // ... other config
    }),
  ],
})
export class MyGraphModule {}
```

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

## Use Cases

- Building AI agent microservices with LangGraph
- Creating conversational AI applications
- Implementing RAG (Retrieval-Augmented Generation) systems
- Developing multi-step AI workflows
- Building interactive AI assistants with callbacks

## Links

- [GitHub Repository](https://github.com/flutchai/node-sdk)
- [NPM Package](https://www.npmjs.com/package/@flutchai/flutch-sdk)
- [Issues](https://github.com/flutchai/node-sdk/issues)

## License

MIT

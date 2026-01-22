# 01 - Basic Graph Example

The simplest example of creating a graph service with Flutch SDK.

## What This Example Demonstrates

- Creating a minimal graph builder by extending `AbstractGraphBuilder`
- Registering the graph with `UniversalGraphModule`
- Using LangGraph's `StateGraph` for graph definition
- Bootstrapping a NestJS application with the SDK

## Project Structure

```
01-basic-graph/
├── src/
│   ├── graph.builder.ts   # Graph builder implementation
│   ├── app.module.ts      # NestJS module configuration
│   └── main.ts            # Application entry point
├── docker-compose.yml     # Redis for callback system
├── package.json
├── tsconfig.json
└── .env.example
```

## Running the Example

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy environment file:

   ```bash
   cp .env.example .env
   ```

3. Start Redis (required for callback system):

   ```bash
   docker compose up -d
   ```

4. Run the example:
   ```bash
   npm start
   ```

## Testing the API

### Health Check

```bash
curl http://localhost:3000/health
```

### List Graph Types

```bash
curl http://localhost:3000/graph-types
```

### Generate Response

```bash
curl -X POST http://localhost:3000/generate \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-001",
    "threadId": "thread-001",
    "userId": "user-001",
    "agentId": "agent-001",
    "graphType": "basic",
    "graphSettings": { "graphType": "basic::1.0.0" },
    "message": { "content": "Hello, World!" }
  }'
```

## Key Concepts

### AbstractGraphBuilder

The `AbstractGraphBuilder` is the base class for all graph implementations:

```typescript
@Injectable()
export class BasicGraphBuilder extends AbstractGraphBuilder<"1.0.0"> {
  readonly version = "1.0.0" as const;

  async buildGraph(payload: IGraphRequestPayload): Promise<any> {
    // Build and return your compiled LangGraph
  }
}
```

### UniversalGraphModule

The `UniversalGraphModule.forRoot()` sets up all the infrastructure:

- REST API endpoints
- Health checks
- Callback system
- Prometheus metrics

### Graph Versioning

The SDK supports semantic versioning for graphs:

- `baseGraphType`: The base name (e.g., "basic")
- `versions`: Array of version configurations
- `defaultVersion`: The version to use when not specified

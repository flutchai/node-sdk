# Flutch SDK Examples

A collection of working examples demonstrating the features of `@flutchai/flutch-sdk`.

## Prerequisites

- Node.js 18+
- Redis (for callback system)
- API keys for LLM providers (OpenAI, Anthropic, etc.)

## Quick Start

```bash
# Choose an example
cd examples/01-basic-graph

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys

# Start Redis
docker compose up -d

# Run
npm start
```

## Examples Overview

| #   | Example                           | Description                    | Key Concepts                                               |
| --- | --------------------------------- | ------------------------------ | ---------------------------------------------------------- |
| 01  | [Basic Graph](./01-basic-graph)   | Minimal graph setup            | `AbstractGraphBuilder`, `UniversalGraphModule`, StateGraph |
| 02  | [Chat Agent](./02-chat-agent)     | Conversational AI with OpenAI  | `MessagesAnnotation`, LLM integration, history             |
| 03  | [RAG Agent](./03-rag-agent)       | Retrieval-Augmented Generation | Multi-node graph, document retrieval, context              |
| 04  | [Tool Calling](./04-tool-calling) | Agent with tools               | `DynamicStructuredTool`, `ToolNode`, agent loop            |
| 05  | [Callbacks](./05-callbacks)       | Interactive user flows         | `@Callback`, `@WithCallbacks`, tokens                      |
| 06  | [Streaming](./06-streaming)       | Real-time SSE streaming        | Server-Sent Events, chunked responses                      |
| 07  | [Multi-LLM](./07-multi-llm)       | Multiple LLM providers         | Provider switching, fallback, factory pattern              |
| 08  | [MCP Tools](./08-mcp-tools)       | MCP tool integration           | Dynamic tools, MCP Runtime                                 |

## Example Structure

Each example follows the same structure:

```
example-name/
├── src/
│   ├── graph.builder.ts   # Graph implementation
│   ├── app.module.ts      # NestJS module
│   └── main.ts            # Entry point
├── docker-compose.yml     # Redis for callback system
├── package.json           # Dependencies
├── tsconfig.json          # TypeScript config
├── .env.example           # Environment template
└── README.md              # Documentation
```

## API Endpoints

All examples expose the same REST API:

| Endpoint       | Method | Description                       |
| -------------- | ------ | --------------------------------- |
| `/health`      | GET    | Health check                      |
| `/graph-types` | GET    | List available graph types        |
| `/generate`    | POST   | Generate response (non-streaming) |
| `/stream`      | POST   | Generate response (SSE streaming) |
| `/callback`    | POST   | Execute a callback                |
| `/registry`    | GET    | View registered graphs            |

## Request Format

```json
{
  "requestId": "unique-request-id",
  "threadId": "conversation-thread-id",
  "userId": "user-identifier",
  "agentId": "agent-identifier",
  "graphType": "graph-name",
  "graphSettings": {
    "graphType": "graph-name::version"
  },
  "message": {
    "content": "User message here"
  },
  "context": {
    "history": [],
    "customField": "value"
  }
}
```

## Learning Path

### Beginner

1. **01-basic-graph** - Understand the fundamentals
2. **02-chat-agent** - Add LLM integration
3. **06-streaming** - Learn about streaming

### Intermediate

4. **03-rag-agent** - Build RAG pipelines
5. **04-tool-calling** - Add tool capabilities
6. **05-callbacks** - Create interactive flows

### Advanced

7. **07-multi-llm** - Multi-provider architecture
8. **08-mcp-tools** - MCP integration

## Common Patterns

### Creating a Graph Builder

```typescript
@Injectable()
export class MyGraphBuilder extends AbstractGraphBuilder<"1.0.0"> {
  readonly version = "1.0.0" as const;

  async buildGraph(payload: IGraphRequestPayload): Promise<any> {
    const graph = new StateGraph(MyState)
      .addNode("process", async state => {
        // Your logic here
        return { result: "processed" };
      })
      .addEdge(START, "process")
      .addEdge("process", END);

    return graph.compile();
  }
}
```

### Registering a Module

```typescript
@Module({
  imports: [
    UniversalGraphModule.forRoot({
      versioning: [
        {
          baseGraphType: "my-graph",
          versions: [
            {
              version: "1.0.0",
              builderClass: MyGraphBuilder,
              status: "stable",
            },
          ],
          defaultVersion: "1.0.0",
        },
      ],
    }),
  ],
  providers: [MyGraphBuilder],
})
export class AppModule {}
```

### Adding Callbacks

```typescript
class MyCallbacks {
  @Callback("action-name")
  async handleAction(context: CallbackContext): Promise<CallbackResult> {
    return { success: true, message: "Done!" };
  }
}

@WithCallbacks(MyCallbacks)
export class MyBuilder extends AbstractGraphBuilder<"1.0.0"> {
  // ...
}
```

## Troubleshooting

### Redis Connection Error

```
Error: connect ECONNREFUSED 127.0.0.1:6379
```

**Solution**: Start Redis with `docker compose up -d`

### Missing API Key

```
Error: OPENAI_API_KEY is not set
```

**Solution**: Copy `.env.example` to `.env` and add your API key

### Graph Type Not Found

```
Error: No builder found for graph type: my-graph
```

**Solution**: Check that `graphType` and `graphSettings.graphType` match your registration

## Resources

- [SDK Documentation](../README.md)
- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/)
- [NestJS Documentation](https://docs.nestjs.com/)
- [GitHub Issues](https://github.com/flutchai/node-sdk/issues)

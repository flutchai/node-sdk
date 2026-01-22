# 08 - MCP Tools Example

Integration with MCP (Model Context Protocol) for dynamic tool loading.

## What This Example Demonstrates

- MCP tool integration pattern
- Dynamic tool loading at runtime
- Tool schema definition and execution
- Agent loop with external tools

## Project Structure

```
08-mcp-tools/
├── src/
│   ├── graph.builder.ts   # MCP-enabled agent
│   ├── app.module.ts      # NestJS module
│   └── main.ts            # Entry point
├── docker-compose.yml     # Redis for callback system
├── package.json
├── tsconfig.json
└── .env.example
```

## What is MCP?

MCP (Model Context Protocol) is a standardized way to:

- Define tool schemas
- Execute tools through a runtime
- Manage tool permissions and configurations
- Provide consistent tool interfaces across services

## Mock Tools in This Example

This example uses mock MCP tools for demonstration:

| Tool                | Description              |
| ------------------- | ------------------------ |
| `search_documents`  | Search through documents |
| `get_user_info`     | Get user information     |
| `create_ticket`     | Create support tickets   |
| `send_notification` | Send notifications       |

## Running the Example

1. Install dependencies:

   ```bash
   npm install
   ```

2. Configure your API key:

   ```bash
   cp .env.example .env
   # Edit .env and add your OPENAI_API_KEY
   ```

3. Start Redis:

   ```bash
   docker compose up -d
   ```

4. Run the example:
   ```bash
   npm start
   ```

## Testing the API

### Search Documents

```bash
curl -X POST http://localhost:3000/generate \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-001",
    "threadId": "thread-001",
    "userId": "user-001",
    "agentId": "agent-001",
    "graphType": "mcp-agent",
    "graphSettings": { "graphType": "mcp-agent::1.0.0" },
    "message": { "content": "Search for documents about authentication" }
  }'
```

### Get User Info

```bash
curl -X POST http://localhost:3000/generate \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-002",
    "threadId": "thread-001",
    "userId": "user-001",
    "agentId": "agent-001",
    "graphType": "mcp-agent",
    "graphSettings": { "graphType": "mcp-agent::1.0.0" },
    "message": { "content": "Get information about user john@example.com" }
  }'
```

### Multiple Tool Calls

```bash
curl -X POST http://localhost:3000/generate \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-003",
    "threadId": "thread-001",
    "userId": "user-001",
    "agentId": "agent-001",
    "graphType": "mcp-agent",
    "graphSettings": { "graphType": "mcp-agent::1.0.0" },
    "message": { "content": "Search for login issues and create a ticket about it" }
  }'
```

## Key Concepts

### MCP Tool Configuration

In production, tools are configured via `IAgentToolConfig`:

```typescript
const toolsConfig: IAgentToolConfig[] = [
  {
    toolName: "search_documents",
    enabled: true,
    config: { maxResults: 10 },
  },
  {
    toolName: "create_ticket",
    enabled: true,
    config: { defaultPriority: "medium" },
  },
];
```

### Loading Tools from MCP Runtime

```typescript
import { McpToolFilter } from "@flutchai/flutch-sdk";

async function loadTools(config: IAgentToolConfig[]) {
  const mcpToolFilter = new McpToolFilter();
  const tools = await mcpToolFilter.getFilteredTools(config);
  return tools;
}
```

### Tool Schema Definition

MCP tools have standardized schemas:

```typescript
{
  name: "search_documents",
  description: "Search through documents",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      maxResults: { type: "number", default: 10 }
    },
    required: ["query"]
  }
}
```

## Production Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Graph Service                          │
│  ┌─────────────┐    ┌──────────────────┐                   │
│  │   Agent     │───▶│   MCP Converter  │                   │
│  │   Node      │    │   (SDK)          │                   │
│  └─────────────┘    └────────┬─────────┘                   │
└───────────────────────────────┼─────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────┐
│                     MCP Runtime                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    │
│  │  Tool A     │    │  Tool B     │    │  Tool C     │    │
│  │  (Server)   │    │  (Server)   │    │  (Server)   │    │
│  └─────────────┘    └─────────────┘    └─────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Benefits of MCP

1. **Standardization**: Consistent tool interface across services
2. **Dynamic Loading**: Tools can be added/removed at runtime
3. **Access Control**: Fine-grained permissions per tool
4. **Versioning**: Tool schemas can be versioned
5. **Monitoring**: Centralized tool usage tracking

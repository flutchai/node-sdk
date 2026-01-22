# 04 - Tool Calling Agent Example

An AI agent that can use tools to perform actions and retrieve information.

## What This Example Demonstrates

- Defining tools with Zod schemas
- Binding tools to LLM
- Using `ToolNode` for automatic tool execution
- Conditional routing based on tool calls
- Agent loop pattern (agent → tools → agent)

## Project Structure

```
04-tool-calling/
├── src/
│   ├── tools.ts           # Tool definitions
│   ├── graph.builder.ts   # Agent with tool calling
│   ├── app.module.ts      # NestJS module
│   └── main.ts            # Entry point
├── docker-compose.yml     # Redis for callback system
├── package.json
├── tsconfig.json
└── .env.example
```

## Agent Flow

```
┌─────────┐     ┌───────┐     ┌───────┐
│  START  │────▶│ agent │────▶│  END  │
└─────────┘     └───┬───┘     └───────┘
                    │              ▲
                    │ has tools    │ no tools
                    ▼              │
                ┌───────┐          │
                │ tools │──────────┘
                └───────┘
```

## Available Tools

### Calculator

```typescript
{
  name: "calculator",
  params: { operation: "add" | "subtract" | "multiply" | "divide", a: number, b: number }
}
```

### Weather

```typescript
{
  name: "get_weather",
  params: { location: string, unit?: "celsius" | "fahrenheit" }
}
```

### Time

```typescript
{
  name: "get_current_time",
  params: { timezone?: string }
}
```

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

### Math Calculation

```bash
curl -X POST http://localhost:3000/generate \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-001",
    "threadId": "thread-001",
    "userId": "user-001",
    "agentId": "agent-001",
    "graphType": "tool-agent",
    "graphSettings": { "graphType": "tool-agent::1.0.0" },
    "message": { "content": "What is 123 * 456?" }
  }'
```

### Weather Query

```bash
curl -X POST http://localhost:3000/generate \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-002",
    "threadId": "thread-001",
    "userId": "user-001",
    "agentId": "agent-001",
    "graphType": "tool-agent",
    "graphSettings": { "graphType": "tool-agent::1.0.0" },
    "message": { "content": "What is the weather in Paris?" }
  }'
```

### Multiple Tools

```bash
curl -X POST http://localhost:3000/generate \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-003",
    "threadId": "thread-001",
    "userId": "user-001",
    "agentId": "agent-001",
    "graphType": "tool-agent",
    "graphSettings": { "graphType": "tool-agent::1.0.0" },
    "message": { "content": "What time is it in Tokyo and what is the temperature there?" }
  }'
```

## Key Concepts

### Defining Tools with Zod

```typescript
const calculatorTool = new DynamicStructuredTool({
  name: "calculator",
  description: "Performs math calculations",
  schema: z.object({
    operation: z.enum(["add", "subtract", "multiply", "divide"]),
    a: z.number(),
    b: z.number(),
  }),
  func: async ({ operation, a, b }) => {
    // Implementation
  },
});
```

### Binding Tools to Model

```typescript
this.model = new ChatOpenAI({
  modelName: "gpt-4o-mini",
  temperature: 0,
}).bindTools(tools);
```

### Conditional Routing

```typescript
const shouldContinue = state => {
  const lastMessage = state.messages[state.messages.length - 1];

  if (lastMessage?.tool_calls?.length) {
    return "tools"; // Route to tools
  }
  return END; // End the conversation
};

graph.addConditionalEdges("agent", shouldContinue);
```

### ToolNode

The `ToolNode` automatically:

1. Extracts tool calls from messages
2. Executes the appropriate tool
3. Returns tool results as messages

# 06 - Streaming Example

Real-time streaming of LLM responses using Server-Sent Events (SSE).

## What This Example Demonstrates

- SSE streaming endpoint
- Real-time token-by-token output
- Difference between streaming and non-streaming endpoints
- Handling stream events

## Project Structure

```
06-streaming/
├── src/
│   ├── graph.builder.ts   # Streaming-enabled chat
│   ├── app.module.ts      # NestJS module
│   └── main.ts            # Entry point
├── docker-compose.yml     # Redis for callback system
├── package.json
├── tsconfig.json
└── .env.example
```

## How Streaming Works

```
┌─────────────────────────────────────────────────────────────┐
│                     POST /stream                             │
│  Content-Type: text/event-stream                            │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │           SSE Events                   │
        │                                        │
        │  event: stream_event                   │
        │  data: {"type":"chunk","content":"O"}  │
        │                                        │
        │  event: stream_event                   │
        │  data: {"type":"chunk","content":"nc"} │
        │                                        │
        │  event: stream_event                   │
        │  data: {"type":"chunk","content":"e "} │
        │                                        │
        │  ...more chunks...                     │
        │                                        │
        │  event: final                          │
        │  data: {"text":"Once upon...","..."}   │
        └───────────────────────────────────────┘
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

## Testing Streaming

### With curl (unbuffered)

```bash
curl -N -X POST http://localhost:3000/stream \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-001",
    "threadId": "thread-001",
    "userId": "user-001",
    "agentId": "agent-001",
    "graphType": "streaming-chat",
    "graphSettings": { "graphType": "streaming-chat::1.0.0" },
    "message": { "content": "Tell me a story about a space explorer" }
  }'
```

The `-N` flag disables buffering so you see chunks immediately.

### Compare with Non-Streaming

```bash
curl -X POST http://localhost:3000/generate \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-002",
    "threadId": "thread-001",
    "userId": "user-001",
    "agentId": "agent-001",
    "graphType": "streaming-chat",
    "graphSettings": { "graphType": "streaming-chat::1.0.0" },
    "message": { "content": "Tell me a story about a space explorer" }
  }'
```

This waits for the complete response before returning.

## SSE Event Format

### Chunk Events

```
event: stream_event
data: {"type":"chunk","content":"Hello"}
```

### Final Event

```
event: final
data: {"text":"Full response...","attachments":[],"metadata":{}}
```

## Client-Side Integration

### JavaScript/TypeScript

```typescript
const eventSource = new EventSource("/stream", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    requestId: "req-001",
    graphType: "streaming-chat",
    message: { content: "Hello" },
    // ... other fields
  }),
});

eventSource.addEventListener("stream_event", event => {
  const data = JSON.parse(event.data);
  if (data.type === "chunk") {
    // Append chunk to UI
    console.log(data.content);
  }
});

eventSource.addEventListener("final", event => {
  const data = JSON.parse(event.data);
  // Handle complete response
  console.log("Complete:", data.text);
  eventSource.close();
});
```

### React Example

```tsx
function StreamingChat() {
  const [response, setResponse] = useState("");

  const sendMessage = async (message: string) => {
    const response = await fetch("/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        graphType: "streaming-chat",
        message: { content: message },
        // ... other fields
      }),
    });

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      // Parse SSE format and update state
      setResponse(prev => prev + parseChunk(chunk));
    }
  };

  return <div>{response}</div>;
}
```

## Key Concepts

### Enabling Streaming

Set `streaming: true` in the model configuration:

```typescript
this.model = new ChatOpenAI({
  modelName: "gpt-4o-mini",
  streaming: true, // Enable streaming
});
```

### Stream vs Generate

| Endpoint    | Behavior              | Use Case              |
| ----------- | --------------------- | --------------------- |
| `/stream`   | Returns SSE events    | Real-time UI updates  |
| `/generate` | Returns complete JSON | Background processing |

### Performance Benefits

- **Lower perceived latency**: Users see content immediately
- **Better UX**: Progressive rendering of long responses
- **Early error detection**: Errors surface faster

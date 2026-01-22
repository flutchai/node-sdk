# 02 - Chat Agent Example

A conversational AI agent using OpenAI's GPT models with Flutch SDK.

## What This Example Demonstrates

- Integrating LLM (OpenAI) with a graph
- Using `MessagesAnnotation` for automatic message history
- Handling conversation context
- Streaming responses

## Project Structure

```
02-chat-agent/
├── src/
│   ├── graph.builder.ts   # Chat agent with LLM
│   ├── app.module.ts      # NestJS module
│   └── main.ts            # Entry point
├── docker-compose.yml     # Redis for callback system
├── package.json
├── tsconfig.json
└── .env.example
```

## Prerequisites

- OpenAI API key
- Node.js 18+
- Redis running locally

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

### Simple Chat

```bash
curl -X POST http://localhost:3000/generate \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-001",
    "threadId": "thread-001",
    "userId": "user-001",
    "agentId": "agent-001",
    "graphType": "chat-agent",
    "graphSettings": { "graphType": "chat-agent::1.0.0" },
    "message": { "content": "What is the capital of France?" }
  }'
```

### Chat with History

```bash
curl -X POST http://localhost:3000/generate \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-002",
    "threadId": "thread-001",
    "userId": "user-001",
    "agentId": "agent-001",
    "graphType": "chat-agent",
    "graphSettings": { "graphType": "chat-agent::1.0.0" },
    "message": { "content": "And what is its population?" },
    "context": {
      "history": [
        { "role": "user", "content": "What is the capital of France?" },
        { "role": "assistant", "content": "The capital of France is Paris." }
      ]
    }
  }'
```

### Streaming Response

```bash
curl -X POST http://localhost:3000/stream \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-003",
    "threadId": "thread-001",
    "userId": "user-001",
    "agentId": "agent-001",
    "graphType": "chat-agent",
    "graphSettings": { "graphType": "chat-agent::1.0.0" },
    "message": { "content": "Write a haiku about programming" }
  }'
```

## Key Concepts

### MessagesAnnotation

The SDK uses LangGraph's `MessagesAnnotation` for automatic message management:

```typescript
const ChatState = Annotation.Root({
  ...MessagesAnnotation.spec,
});
```

This provides:

- Automatic message history tracking
- Proper message formatting
- Easy integration with LLMs

### Model Configuration

Configure the OpenAI model in the builder:

```typescript
this.model = new ChatOpenAI({
  modelName: "gpt-4o-mini", // Model to use
  temperature: 0.7, // Creativity level
  streaming: true, // Enable streaming
});
```

### Conversation History

Pass conversation history via the `context.history` field:

```typescript
{
  "context": {
    "history": [
      { "role": "user", "content": "Previous message" },
      { "role": "assistant", "content": "Previous response" }
    ]
  }
}
```

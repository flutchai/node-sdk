import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`
========================================
  Streaming Example is running!
========================================

This example demonstrates Server-Sent Events (SSE)
for real-time streaming of LLM responses.

Endpoints:
  - POST /generate  - Non-streaming (waits for complete response)
  - POST /stream    - Streaming (SSE events)

Streaming example with curl:
  curl -N -X POST http://localhost:${port}/stream \\
    -H "Content-Type: application/json" \\
    -d '{
      "requestId": "req-001",
      "threadId": "thread-001",
      "userId": "user-001",
      "agentId": "agent-001",
      "graphType": "streaming-chat",
      "graphSettings": { "graphType": "streaming-chat::1.0.0" },
      "message": { "content": "Tell me a short story about a robot learning to paint" }
    }'

The -N flag prevents curl from buffering, so you see
chunks as they arrive.

Server is running on: http://localhost:${port}
  `);
}

bootstrap().catch(console.error);

import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`
========================================
  Chat Agent Example is running!
========================================

Available endpoints:
  - GET  /health          - Health check
  - GET  /graph-types     - List supported graph types
  - POST /generate        - Generate response (non-streaming)
  - POST /stream          - Generate response (streaming)

Example request:
  curl -X POST http://localhost:${port}/generate \\
    -H "Content-Type: application/json" \\
    -d '{
      "requestId": "req-001",
      "threadId": "thread-001",
      "userId": "user-001",
      "agentId": "agent-001",
      "graphType": "chat-agent",
      "graphSettings": { "graphType": "chat-agent::1.0.0" },
      "message": { "content": "Hello! What can you help me with today?" }
    }'

Streaming example:
  curl -X POST http://localhost:${port}/stream \\
    -H "Content-Type: application/json" \\
    -d '{
      "requestId": "req-002",
      "threadId": "thread-001",
      "userId": "user-001",
      "agentId": "agent-001",
      "graphType": "chat-agent",
      "graphSettings": { "graphType": "chat-agent::1.0.0" },
      "message": { "content": "Tell me a short story" }
    }'

Server is running on: http://localhost:${port}
  `);
}

bootstrap().catch(console.error);

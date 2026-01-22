import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`
========================================
  RAG Agent Example is running!
========================================

This example includes a simple in-memory document store
with information about the Flutch SDK.

Try asking questions like:
  - "What is Flutch SDK?"
  - "How do I create a graph builder?"
  - "What LLM providers are supported?"
  - "How do callbacks work?"

Example request:
  curl -X POST http://localhost:${port}/generate \\
    -H "Content-Type: application/json" \\
    -d '{
      "requestId": "req-001",
      "threadId": "thread-001",
      "userId": "user-001",
      "agentId": "agent-001",
      "graphType": "rag-agent",
      "graphSettings": { "graphType": "rag-agent::1.0.0" },
      "message": { "content": "What is Flutch SDK?" }
    }'

Server is running on: http://localhost:${port}
  `);
}

bootstrap().catch(console.error);

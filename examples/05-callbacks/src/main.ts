import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`
========================================
  Callbacks Example is running!
========================================

This example demonstrates interactive callbacks
for an order processing workflow.

Available callback handlers:
  - approve-order: Approve an order
  - reject-order: Reject an order
  - request-info: Request more information

Example request (create order):
  curl -X POST http://localhost:${port}/generate \\
    -H "Content-Type: application/json" \\
    -d '{
      "requestId": "req-001",
      "threadId": "thread-001",
      "userId": "user-001",
      "agentId": "agent-001",
      "graphType": "order-processor",
      "graphSettings": { "graphType": "order-processor::1.0.0" },
      "message": { "content": "Process my order" }
    }'

Example callback invocation:
  curl -X POST http://localhost:${port}/callback \\
    -H "Content-Type: application/json" \\
    -d '{
      "token": "<callback_token_from_response>",
      "userId": "user-001",
      "threadId": "thread-001"
    }'

Server is running on: http://localhost:${port}
  `);
}

bootstrap().catch(console.error);

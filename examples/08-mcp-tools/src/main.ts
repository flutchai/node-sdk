import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`
========================================
  MCP Tools Example is running!
========================================

This example demonstrates MCP (Model Context Protocol)
tool integration with mock tools.

Available mock MCP tools:
  - search_documents: Search knowledge base
  - get_user_info: Get user information
  - create_ticket: Create support ticket
  - send_notification: Send notifications

Try these queries:
  - "Search for documents about authentication"
  - "Get user info for john@example.com"
  - "Create a ticket about login issues"
  - "Send a notification to the support team"

Example request:
  curl -X POST http://localhost:${port}/generate \\
    -H "Content-Type: application/json" \\
    -d '{
      "requestId": "req-001",
      "threadId": "thread-001",
      "userId": "user-001",
      "agentId": "agent-001",
      "graphType": "mcp-agent",
      "graphSettings": { "graphType": "mcp-agent::1.0.0" },
      "message": { "content": "Search for documents about user authentication" }
    }'

Server is running on: http://localhost:${port}
  `);
}

bootstrap().catch(console.error);

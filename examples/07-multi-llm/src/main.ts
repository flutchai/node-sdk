import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { ModelFactory } from "./model-factory.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const port = process.env.PORT || 3000;
  await app.listen(port);

  const availableProviders = ModelFactory.getAvailableProviders();

  console.log(`
========================================
  Multi-LLM Example is running!
========================================

Available providers: ${availableProviders.join(", ") || "None (add API keys to .env)"}

Use the "context.provider" field to select which LLM to use:
  - "openai"    → GPT-4o-mini
  - "anthropic" → Claude 3 Haiku
  - "mistral"   → Mistral Small

Example with OpenAI:
  curl -X POST http://localhost:${port}/generate \\
    -H "Content-Type: application/json" \\
    -d '{
      "requestId": "req-001",
      "threadId": "thread-001",
      "userId": "user-001",
      "agentId": "agent-001",
      "graphType": "multi-llm",
      "graphSettings": { "graphType": "multi-llm::1.0.0" },
      "message": { "content": "What is the meaning of life?" },
      "context": { "provider": "openai" }
    }'

Example with Anthropic:
  curl -X POST http://localhost:${port}/generate \\
    -H "Content-Type: application/json" \\
    -d '{
      "requestId": "req-002",
      "threadId": "thread-001",
      "userId": "user-001",
      "agentId": "agent-001",
      "graphType": "multi-llm",
      "graphSettings": { "graphType": "multi-llm::1.0.0" },
      "message": { "content": "What is the meaning of life?" },
      "context": { "provider": "anthropic" }
    }'

Server is running on: http://localhost:${port}
  `);
}

bootstrap().catch(console.error);

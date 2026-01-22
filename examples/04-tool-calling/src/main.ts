import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`
========================================
  Tool Calling Agent Example is running!
========================================

Available tools:
  - calculator: Performs math operations (add, subtract, multiply, divide)
  - get_weather: Returns weather for a location
  - get_current_time: Returns current date/time

Try these queries:
  - "What is 42 * 17?"
  - "What's the weather in Tokyo?"
  - "What time is it in New York?"
  - "Calculate 100 divided by 7 and tell me the weather in London"

Example request:
  curl -X POST http://localhost:${port}/generate \\
    -H "Content-Type: application/json" \\
    -d '{
      "requestId": "req-001",
      "threadId": "thread-001",
      "userId": "user-001",
      "agentId": "agent-001",
      "graphType": "tool-agent",
      "graphSettings": { "graphType": "tool-agent::1.0.0" },
      "message": { "content": "What is 42 * 17?" }
    }'

Server is running on: http://localhost:${port}
  `);
}

bootstrap().catch(console.error);

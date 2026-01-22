# 07 - Multi-LLM Example

Switch between multiple LLM providers (OpenAI, Anthropic, Mistral) at runtime.

## What This Example Demonstrates

- Using multiple LLM providers in a single service
- Runtime provider selection via request context
- Model factory pattern for clean provider abstraction
- Graceful fallback when a provider is unavailable

## Project Structure

```
07-multi-llm/
├── src/
│   ├── model-factory.ts   # LLM provider factory
│   ├── graph.builder.ts   # Multi-provider graph
│   ├── app.module.ts      # NestJS module
│   └── main.ts            # Entry point
├── docker-compose.yml     # Redis for callback system
├── package.json
├── tsconfig.json
└── .env.example
```

## Supported Providers

| Provider  | Model          | Environment Variable |
| --------- | -------------- | -------------------- |
| OpenAI    | gpt-4o-mini    | `OPENAI_API_KEY`     |
| Anthropic | claude-3-haiku | `ANTHROPIC_API_KEY`  |
| Mistral   | mistral-small  | `MISTRAL_API_KEY`    |

## Running the Example

1. Install dependencies:

   ```bash
   npm install
   ```

2. Configure at least one API key:

   ```bash
   cp .env.example .env
   # Edit .env and add your API keys
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

### Using OpenAI

```bash
curl -X POST http://localhost:3000/generate \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-001",
    "threadId": "thread-001",
    "userId": "user-001",
    "agentId": "agent-001",
    "graphType": "multi-llm",
    "graphSettings": { "graphType": "multi-llm::1.0.0" },
    "message": { "content": "Explain quantum computing in simple terms" },
    "context": { "provider": "openai" }
  }'
```

### Using Anthropic

```bash
curl -X POST http://localhost:3000/generate \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-002",
    "threadId": "thread-001",
    "userId": "user-001",
    "agentId": "agent-001",
    "graphType": "multi-llm",
    "graphSettings": { "graphType": "multi-llm::1.0.0" },
    "message": { "content": "Explain quantum computing in simple terms" },
    "context": { "provider": "anthropic" }
  }'
```

### Using Mistral

```bash
curl -X POST http://localhost:3000/generate \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-003",
    "threadId": "thread-001",
    "userId": "user-001",
    "agentId": "agent-001",
    "graphType": "multi-llm",
    "graphSettings": { "graphType": "multi-llm::1.0.0" },
    "message": { "content": "Explain quantum computing in simple terms" },
    "context": { "provider": "mistral" }
  }'
```

## Key Concepts

### Model Factory

The `ModelFactory` class abstracts provider-specific initialization:

```typescript
export class ModelFactory {
  static createModel(config: ModelConfig): BaseChatModel {
    switch (config.provider) {
      case "openai":
        return new ChatOpenAI({ modelName: config.model, ... });
      case "anthropic":
        return new ChatAnthropic({ modelName: config.model, ... });
      case "mistral":
        return new ChatMistralAI({ model: config.model, ... });
    }
  }
}
```

### Runtime Provider Selection

Pass the provider in the request context:

```typescript
{
  "context": {
    "provider": "anthropic"  // or "openai", "mistral"
  }
}
```

### Fallback Behavior

If the requested provider is unavailable, the system falls back to the first available provider:

```typescript
private getModel(provider: LLMProvider): BaseChatModel {
  const model = this.models.get(provider);
  if (!model) {
    // Fallback to first available
    const [firstProvider, firstModel] = this.models.entries().next().value;
    return firstModel;
  }
  return model;
}
```

## Use Cases

### A/B Testing

Compare responses from different providers for the same query.

### Cost Optimization

Route simple queries to cheaper models, complex ones to more capable models.

### Redundancy

Fall back to alternative providers if the primary is unavailable.

### Specialized Tasks

Use different providers for different tasks based on their strengths:

- OpenAI for code generation
- Anthropic for analysis and safety
- Mistral for European language support

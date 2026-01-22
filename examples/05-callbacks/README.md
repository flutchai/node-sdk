# 05 - Callbacks Example

Interactive callbacks for user choices in AI workflows.

## What This Example Demonstrates

- Using `@Callback` decorator for callback handlers
- Using `@WithCallbacks` decorator to attach callbacks to builders
- Creating interactive buttons/actions
- Processing user choices through the callback system

## Project Structure

```
05-callbacks/
├── src/
│   ├── callbacks.ts       # Callback handler definitions
│   ├── graph.builder.ts   # Order processing graph
│   ├── app.module.ts      # NestJS module
│   └── main.ts            # Entry point
├── docker-compose.yml     # Redis for callback system
├── package.json
├── tsconfig.json
└── .env.example
```

## Callback Flow

```
┌───────────────────────────────────────────────────────────────┐
│                      User Request                              │
└───────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────┐
│                    Graph Execution                             │
│  ┌─────────────┐    ┌──────────────────────┐                  │
│  │ parse_order │───▶│ generate_response    │                  │
│  └─────────────┘    │ (with callback btns) │                  │
│                     └──────────────────────┘                  │
└───────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────┐
│                   Response with Buttons                        │
│  [Approve Order] [Reject Order] [Request Info]                │
└───────────────────────────────────────────────────────────────┘
                              │
                        User clicks
                              │
                              ▼
┌───────────────────────────────────────────────────────────────┐
│                   POST /callback                               │
│   token: "cb_order-processor_approve-order_..."               │
└───────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────┐
│                   Callback Handler                             │
│   @Callback("approve-order")                                   │
│   handleApproveOrder(context) → CallbackResult                │
└───────────────────────────────────────────────────────────────┘
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

3. Start Redis (required for callback tokens):

   ```bash
   docker compose up -d
   ```

4. Run the example:
   ```bash
   npm start
   ```

## Testing the API

### Create an Order

```bash
curl -X POST http://localhost:3000/generate \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-001",
    "threadId": "thread-001",
    "userId": "user-001",
    "agentId": "agent-001",
    "graphType": "order-processor",
    "graphSettings": { "graphType": "order-processor::1.0.0" },
    "message": { "content": "Process my new order" }
  }'
```

The response will include callback buttons. Each button has a token that can be used to invoke the callback.

### Invoke a Callback

```bash
curl -X POST http://localhost:3000/callback \
  -H "Content-Type: application/json" \
  -d '{
    "token": "<token_from_callback_button>",
    "userId": "user-001",
    "threadId": "thread-001"
  }'
```

## Key Concepts

### Defining Callbacks

Use the `@Callback` decorator to define callback handlers:

```typescript
export class OrderCallbacks {
  @Callback("approve-order")
  async handleApproveOrder(context: CallbackContext): Promise<CallbackResult> {
    const orderId = context.params?.orderId;
    return {
      success: true,
      message: `Order #${orderId} approved!`,
      data: { orderId, status: "approved" },
    };
  }
}
```

### Attaching Callbacks to Builder

Use `@WithCallbacks` to mix callbacks into your builder:

```typescript
@Injectable()
@WithCallbacks(OrderCallbacks)
export class OrderProcessingBuilder extends AbstractGraphBuilder<"1.0.0"> {
  // Callbacks are automatically registered
}
```

### Callback Context

The callback context includes:

```typescript
interface CallbackContext {
  userId: string; // User who triggered the callback
  threadId?: string; // Conversation thread ID
  agentId?: string; // Agent ID
  params?: any; // Parameters passed with the callback
  metadata?: any; // Additional metadata
}
```

### Callback Result

Return a `CallbackResult` from your handler:

```typescript
interface CallbackResult {
  success: boolean;
  message?: string;
  data?: any;
  error?: string;
}
```

### Creating Callback Buttons

In your graph, create buttons with handlers:

```typescript
const callbackButtons = [
  {
    label: "Approve",
    handler: "approve-order", // Matches @Callback("approve-order")
    params: { orderId },
    style: "primary",
  },
];
```

## Security Features

The callback system includes:

- **Token-based authentication**: Each callback gets a unique token
- **ACL checks**: Verify user permissions
- **Rate limiting**: Prevent abuse
- **Idempotency**: Prevent duplicate executions
- **Audit logging**: Track all callback invocations

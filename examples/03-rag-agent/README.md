# 03 - RAG Agent Example

A Retrieval-Augmented Generation (RAG) agent that answers questions based on retrieved documents.

## What This Example Demonstrates

- Building a RAG pipeline with LangGraph
- Document retrieval (simplified in-memory store)
- Context-aware answer generation
- Multi-node graph with data flow

## Project Structure

```
03-rag-agent/
├── src/
│   ├── graph.builder.ts   # RAG agent with retrieval
│   ├── app.module.ts      # NestJS module
│   └── main.ts            # Entry point
├── docker-compose.yml     # Redis for callback system
├── package.json
├── tsconfig.json
└── .env.example
```

## RAG Pipeline

```
┌─────────┐     ┌──────────┐     ┌──────────┐
│  START  │────▶│ retrieve │────▶│ generate │────▶ END
└─────────┘     └──────────┘     └──────────┘
                     │                 │
                     ▼                 ▼
              Find relevant      Generate answer
              documents          with context
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

3. Start Redis:

   ```bash
   docker compose up -d
   ```

4. Run the example:
   ```bash
   npm start
   ```

## Testing the API

### Ask About Flutch SDK

```bash
curl -X POST http://localhost:3000/generate \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-001",
    "threadId": "thread-001",
    "userId": "user-001",
    "agentId": "agent-001",
    "graphType": "rag-agent",
    "graphSettings": { "graphType": "rag-agent::1.0.0" },
    "message": { "content": "What is Flutch SDK?" }
  }'
```

### Ask About Graph Builders

```bash
curl -X POST http://localhost:3000/generate \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-002",
    "threadId": "thread-001",
    "userId": "user-001",
    "agentId": "agent-001",
    "graphType": "rag-agent",
    "graphSettings": { "graphType": "rag-agent::1.0.0" },
    "message": { "content": "How do I create a graph builder?" }
  }'
```

## Key Concepts

### State Definition

The RAG state tracks the query, retrieved documents, and final answer:

```typescript
const RagState = Annotation.Root({
  query: Annotation<string>(),
  documents: Annotation<Document[]>(),
  answer: Annotation<string>(),
});
```

### Retrieval Node

Finds relevant documents based on the query:

```typescript
.addNode("retrieve", async (state) => {
  const documents = await documentStore.retrieve(state.query, 3);
  return { documents };
})
```

### Generation Node

Creates an answer using retrieved context:

```typescript
.addNode("generate", async (state) => {
  const context = state.documents
    .map((doc, i) => `[${i + 1}] ${doc.pageContent}`)
    .join("\n\n");

  const prompt = `Answer based on context...\n${context}`;
  const response = await model.invoke([new HumanMessage(prompt)]);
  return { answer: response.content };
})
```

## Production Considerations

This example uses a simple in-memory document store. In production:

1. **Use a Vector Database**: Pinecone, Weaviate, Qdrant, Chroma, etc.
2. **Generate Embeddings**: Use OpenAI, Cohere, or other embedding models
3. **Implement Chunking**: Split large documents into smaller chunks
4. **Add Reranking**: Use a reranker for better relevance
5. **Cache Results**: Cache frequent queries for performance

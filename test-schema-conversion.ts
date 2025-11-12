import { McpConverter } from "./src/tools/mcp-converter";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Logger } from "@nestjs/common";

// Disable debug logging
Logger.overrideLogger(["log", "error", "warn"]);

async function testSchemaConversion() {
  const converter = new McpConverter("http://localhost:3004");

  console.log("🔍 Fetching tools from MCP Runtime...\n");

  const tools = await converter.fetchAndConvertTools();

  // Test execute_pandas_code
  const pandaTool = tools.find(t => t.name === "execute_pandas_code");
  if (pandaTool) {
    console.log("=== execute_pandas_code ===");
    console.log(
      "Tool description:",
      pandaTool.description.substring(0, 100) + "..."
    );

    // Get Zod schema
    const zodSchema = (pandaTool as any).schema;

    console.log("Zod schema type:", zodSchema?._def?.typeName);
    console.log(
      "Zod schema:",
      JSON.stringify(zodSchema, null, 2).substring(0, 300)
    );

    // Convert back to JSON Schema (same as LangChain does internally)
    const jsonSchema = zodToJsonSchema(zodSchema);

    console.log("\n📋 JSON Schema after zodToJsonSchema:");
    console.log(JSON.stringify(jsonSchema, null, 2));
    console.log("\n");
  }

  // Test fetch tool
  const fetchTool = tools.find(t => t.name === "fetch");
  if (fetchTool) {
    console.log("=== fetch ===");
    console.log(
      "Tool description:",
      fetchTool.description.substring(0, 100) + "..."
    );

    const zodSchema = (fetchTool as any).schema;
    const jsonSchema = zodToJsonSchema(zodSchema);

    console.log("\n📋 JSON Schema properties:");
    if (jsonSchema.properties) {
      Object.entries(jsonSchema.properties).forEach(
        ([key, prop]: [string, any]) => {
          console.log(`  - ${key}:`);
          console.log(`    type: ${prop.type}`);
          console.log(
            `    description: ${prop.description || "❌ NO DESCRIPTION"}`
          );
        }
      );
    }
    console.log("\n");
  }

  // Test postgres_query (internal tool)
  const postgresTool = tools.find(t => t.name === "postgres_query");
  if (postgresTool) {
    console.log("=== postgres_query (internal) ===");
    console.log("Tool description:", postgresTool.description);

    const zodSchema = (postgresTool as any).schema;
    const jsonSchema = zodToJsonSchema(zodSchema);

    console.log("\n📋 JSON Schema properties:");
    if (jsonSchema.properties) {
      Object.entries(jsonSchema.properties).forEach(
        ([key, prop]: [string, any]) => {
          console.log(`  - ${key}:`);
          console.log(`    type: ${prop.type}`);
          console.log(
            `    description: ${prop.description || "❌ NO DESCRIPTION"}`
          );
        }
      );
    }
    console.log("\n");
  }
}

testSchemaConversion().catch(console.error);

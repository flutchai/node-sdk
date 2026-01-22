import { Module } from "@nestjs/common";
import { UniversalGraphModule } from "@flutchai/flutch-sdk";
import { McpAgentBuilder } from "./graph.builder";

@Module({
  imports: [
    UniversalGraphModule.forRoot({
      versioning: [
        {
          baseGraphType: "mcp-agent",
          versions: [
            {
              version: "1.0.0",
              builderClass: McpAgentBuilder,
              isDefault: true,
            },
          ],
        },
      ],
    }),
  ],
  providers: [McpAgentBuilder],
})
export class AppModule {}

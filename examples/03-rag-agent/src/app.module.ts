import { Module } from "@nestjs/common";
import { UniversalGraphModule } from "@flutchai/flutch-sdk";
import { RagAgentBuilder } from "./graph.builder";

@Module({
  imports: [
    UniversalGraphModule.forRoot({
      versioning: [
        {
          baseGraphType: "rag-agent",
          versions: [
            {
              version: "1.0.0",
              builderClass: RagAgentBuilder,
              isDefault: true,
            },
          ],
        },
      ],
    }),
  ],
  providers: [RagAgentBuilder],
})
export class AppModule {}

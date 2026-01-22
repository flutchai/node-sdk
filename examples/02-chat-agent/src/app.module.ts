import { Module } from "@nestjs/common";
import { UniversalGraphModule } from "@flutchai/flutch-sdk";
import { ChatAgentBuilder } from "./graph.builder";

@Module({
  imports: [
    UniversalGraphModule.forRoot({
      versioning: [
        {
          baseGraphType: "chat-agent",
          versions: [
            {
              version: "1.0.0",
              builderClass: ChatAgentBuilder,
              isDefault: true,
            },
          ],
        },
      ],
    }),
  ],
  providers: [ChatAgentBuilder],
})
export class AppModule {}

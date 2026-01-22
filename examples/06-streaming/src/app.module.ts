import { Module } from "@nestjs/common";
import { UniversalGraphModule } from "@flutchai/flutch-sdk";
import { StreamingChatBuilder } from "./graph.builder";

@Module({
  imports: [
    UniversalGraphModule.forRoot({
      versioning: [
        {
          baseGraphType: "streaming-chat",
          versions: [
            {
              version: "1.0.0",
              builderClass: StreamingChatBuilder,
              isDefault: true,
            },
          ],
        },
      ],
    }),
  ],
  providers: [StreamingChatBuilder],
})
export class AppModule {}

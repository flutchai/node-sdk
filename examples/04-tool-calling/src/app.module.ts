import { Module } from "@nestjs/common";
import { UniversalGraphModule } from "@flutchai/flutch-sdk";
import { ToolCallingAgentBuilder } from "./graph.builder";

@Module({
  imports: [
    UniversalGraphModule.forRoot({
      versioning: [
        {
          baseGraphType: "tool-agent",
          versions: [
            {
              version: "1.0.0",
              builderClass: ToolCallingAgentBuilder,
              isDefault: true,
            },
          ],
        },
      ],
    }),
  ],
  providers: [ToolCallingAgentBuilder],
})
export class AppModule {}

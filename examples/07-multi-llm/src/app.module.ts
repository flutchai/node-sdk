import { Module } from "@nestjs/common";
import { UniversalGraphModule } from "@flutchai/flutch-sdk";
import { MultiLLMBuilder } from "./graph.builder";

@Module({
  imports: [
    UniversalGraphModule.forRoot({
      versioning: [
        {
          baseGraphType: "multi-llm",
          versions: [
            {
              version: "1.0.0",
              builderClass: MultiLLMBuilder,
              isDefault: true,
            },
          ],
        },
      ],
    }),
  ],
  providers: [MultiLLMBuilder],
})
export class AppModule {}

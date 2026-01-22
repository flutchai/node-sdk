import { Module } from "@nestjs/common";
import { UniversalGraphModule } from "@flutchai/flutch-sdk";
import { BasicGraphBuilder } from "./graph.builder";

@Module({
  imports: [
    // Register the UniversalGraphModule with our graph builder
    UniversalGraphModule.forRoot({
      // Configure versioning for our basic graph
      versioning: [
        {
          baseGraphType: "basic",
          versions: [
            {
              version: "1.0.0",
              builderClass: BasicGraphBuilder,
              isDefault: true,
            },
          ],
        },
      ],
    }),
  ],
  providers: [BasicGraphBuilder],
})
export class AppModule {}

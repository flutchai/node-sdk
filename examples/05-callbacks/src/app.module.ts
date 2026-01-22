import { Module } from "@nestjs/common";
import { UniversalGraphModule } from "@flutchai/flutch-sdk";
import { OrderProcessingBuilder } from "./graph.builder";

@Module({
  imports: [
    UniversalGraphModule.forRoot({
      versioning: [
        {
          baseGraphType: "order-processor",
          versions: [
            {
              version: "1.0.0",
              builderClass: OrderProcessingBuilder,
              isDefault: true,
            },
          ],
        },
      ],
    }),
  ],
  providers: [OrderProcessingBuilder],
})
export class AppModule {}

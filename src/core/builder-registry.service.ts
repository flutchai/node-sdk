// builder-registry.service.ts
import { Injectable } from "@nestjs/common";
import { AbstractGraphBuilder } from "../graph/abstract-graph.builder";

@Injectable()
export class BuilderRegistryService {
  private builders: AbstractGraphBuilder<string>[] = [];

  registerBuilder(builder: AbstractGraphBuilder<string>) {
    // Check if builder with this graphType is already registered
    const existingBuilder = this.builders.find(
      b => b.graphType === builder.graphType
    );

    if (!existingBuilder) {
      this.builders.push(builder);
    }
    // If builder is already registered, simply ignore (avoid duplicates)
  }

  getBuilders(): AbstractGraphBuilder<string>[] {
    return this.builders;
  }
}

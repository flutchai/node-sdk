/**
 * JSON Schema for graph manifest validation
 */
export const GraphManifestSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  title: "Graph Manifest Schema",
  description: "Schema for validating graph manifest files",
  properties: {
    graphType: {
      type: "string",
      description: "Unique identifier for the graph type",
      pattern: "^[a-z][a-zA-Z0-9]*$",
    },
    title: {
      type: "string",
      description: "Human-readable title for the graph",
      minLength: 1,
      maxLength: 100,
    },
    description: {
      type: "string",
      description: "Short description of the graph",
      minLength: 1,
      maxLength: 500,
    },
    detailedDescription: {
      type: "string",
      description: "Detailed description with markdown support",
      minLength: 1,
    },
    category: {
      type: "string",
      description: "Category for grouping graphs",
      enum: ["basic", "specialized", "advanced", "experimental"],
    },
    tags: {
      type: "array",
      description: "Tags for filtering and searching",
      items: {
        type: "string",
        pattern: "^[a-z][a-zA-Z0-9-]*$",
      },
      uniqueItems: true,
    },
    hue: {
      type: "number",
      description: "Color hue for UI representation (0-360)",
      minimum: 0,
      maximum: 360,
    },
    visibility: {
      type: "string",
      description: "Visibility level for the graph",
      enum: ["public", "private"],
      default: "public",
    },
    isEmbedded: {
      type: "boolean",
      description: "Whether the graph runs in embedded mode",
      default: true,
    },
    isActive: {
      type: "boolean",
      description: "Whether the graph is currently active",
      default: true,
    },
    schema: {
      type: "object",
      description: "JSON Schema for graph configuration",
      properties: {
        type: {
          type: "string",
          const: "object",
        },
        properties: {
          type: "object",
          additionalProperties: {
            type: "object",
            properties: {
              type: { type: "string" },
              title: { type: "string" },
              description: { type: "string" },
              default: {},
              minimum: { type: "number" },
              maximum: { type: "number" },
              minLength: { type: "number" },
              maxLength: { type: "number" },
              format: { type: "string" },
              enum: { type: "array" },
            },
            required: ["type", "title"],
          },
        },
        required: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["type", "properties", "required"],
      additionalProperties: false,
    },
    defaultSettings: {
      type: "object",
      description: "Default settings for the graph",
    },
  },
  required: ["graphType", "title", "description", "schema"],
  additionalProperties: false,
};

/**
 * Validation functions for graph manifests
 */
export class GraphManifestValidator {
  /**
   * Validate a graph manifest against the schema
   */
  static validate(manifest: any): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    try {
      // Check required fields
      const required = GraphManifestSchema.required as string[];
      for (const field of required) {
        if (!manifest.hasOwnProperty(field)) {
          errors.push(`Missing required field: ${field}`);
        }
      }

      // Validate graphType format - allow dots, colons, and hyphens for versioned types
      if (
        manifest.graphType &&
        !/^[a-z][a-zA-Z0-9._:-]*$/.test(manifest.graphType)
      ) {
        errors.push(`graphType must match pattern: ^[a-z][a-zA-Z0-9._:-]*$`);
      }

      // Validate category
      if (
        manifest.category &&
        !["basic", "specialized", "advanced", "experimental"].includes(
          manifest.category
        )
      ) {
        errors.push(
          `category must be one of: basic, specialized, advanced, experimental`
        );
      }

      // Validate visibility
      if (
        manifest.visibility &&
        !["public", "private"].includes(manifest.visibility)
      ) {
        errors.push(`visibility must be one of: public, private`);
      }

      // Validate hue range
      if (
        manifest.hue !== undefined &&
        (manifest.hue < 0 || manifest.hue > 360)
      ) {
        errors.push(`hue must be between 0 and 360`);
      }

      // Validate schema structure
      if (manifest.schema) {
        if (manifest.schema.type !== "object") {
          errors.push(`schema.type must be "object"`);
        }
        if (
          !manifest.schema.properties ||
          typeof manifest.schema.properties !== "object"
        ) {
          errors.push(`schema.properties must be an object`);
        }
        if (!Array.isArray(manifest.schema.required)) {
          errors.push(`schema.required must be an array`);
        }
      }

      // Validate tags
      if (manifest.tags && Array.isArray(manifest.tags)) {
        for (const tag of manifest.tags) {
          if (typeof tag !== "string" || !/^[a-z][a-zA-Z0-9-]*$/.test(tag)) {
            errors.push(
              `Invalid tag format: ${tag}. Tags must match pattern: ^[a-z][a-zA-Z0-9-]*$`
            );
          }
        }

        // Check for duplicate tags
        const uniqueTags = new Set(manifest.tags);
        if (uniqueTags.size !== manifest.tags.length) {
          errors.push(`Duplicate tags found`);
        }
      }

      return {
        isValid: errors.length === 0,
        errors,
      };
    } catch (error: any) {
      return {
        isValid: false,
        errors: [`Validation error: ${error.message}`],
      };
    }
  }

  /**
   * Validate and throw if invalid
   */
  static validateOrThrow(manifest: any): void {
    const result = this.validate(manifest);
    if (!result.isValid) {
      throw new Error(
        `Graph manifest validation failed:\n${result.errors.join("\n")}`
      );
    }
  }
}

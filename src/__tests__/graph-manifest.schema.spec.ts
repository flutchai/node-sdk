import {
  GraphManifestSchema,
  GraphManifestValidator,
} from "../graph/graph-manifest.schema";

describe("GraphManifestSchema", () => {
  it("should define required fields", () => {
    expect(GraphManifestSchema.required).toEqual([
      "graphType",
      "title",
      "description",
      "schema",
    ]);
  });

  it("should not allow additional properties", () => {
    expect(GraphManifestSchema.additionalProperties).toBe(false);
  });
});

describe("GraphManifestValidator", () => {
  const validManifest = {
    graphType: "simpleChat",
    title: "Simple Chat",
    description: "A simple chat graph",
    schema: {
      type: "object",
      properties: {
        temperature: {
          type: "number",
          title: "Temperature",
        },
      },
      required: ["temperature"],
    },
  };

  describe("validate", () => {
    it("should pass for a valid manifest", () => {
      const result = GraphManifestValidator.validate(validManifest);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should pass with all optional fields", () => {
      const full = {
        ...validManifest,
        detailedDescription: "Detailed markdown description",
        category: "basic",
        tags: ["chat", "simple"],
        hue: 180,
        visibility: "public",
        isEmbedded: true,
        isActive: true,
        defaultSettings: { temperature: 0.7 },
      };
      const result = GraphManifestValidator.validate(full);
      expect(result.isValid).toBe(true);
    });

    // Required fields
    it("should fail when graphType is missing", () => {
      const { graphType, ...rest } = validManifest;
      const result = GraphManifestValidator.validate(rest);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Missing required field: graphType");
    });

    it("should fail when title is missing", () => {
      const { title, ...rest } = validManifest;
      const result = GraphManifestValidator.validate(rest);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Missing required field: title");
    });

    it("should fail when description is missing", () => {
      const { description, ...rest } = validManifest;
      const result = GraphManifestValidator.validate(rest);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Missing required field: description");
    });

    it("should fail when schema is missing", () => {
      const { schema, ...rest } = validManifest;
      const result = GraphManifestValidator.validate(rest);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Missing required field: schema");
    });

    it("should report all missing required fields at once", () => {
      const result = GraphManifestValidator.validate({});
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(4);
    });

    // graphType validation
    it("should fail for invalid graphType format", () => {
      const manifest = { ...validManifest, graphType: "123invalid" };
      const result = GraphManifestValidator.validate(manifest);
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain("graphType must match pattern");
    });

    it("should accept graphType with dots, colons, hyphens", () => {
      const manifest = {
        ...validManifest,
        graphType: "global.simple::1.0.0",
      };
      const result = GraphManifestValidator.validate(manifest);
      expect(result.isValid).toBe(true);
    });

    // Category validation
    it("should fail for invalid category", () => {
      const manifest = { ...validManifest, category: "invalid" };
      const result = GraphManifestValidator.validate(manifest);
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain("category must be one of");
    });

    it("should accept all valid categories", () => {
      for (const category of [
        "basic",
        "specialized",
        "advanced",
        "experimental",
      ]) {
        const manifest = { ...validManifest, category };
        const result = GraphManifestValidator.validate(manifest);
        expect(result.isValid).toBe(true);
      }
    });

    // Visibility validation
    it("should fail for invalid visibility", () => {
      const manifest = { ...validManifest, visibility: "hidden" };
      const result = GraphManifestValidator.validate(manifest);
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain("visibility must be one of");
    });

    it("should accept public and private visibility", () => {
      for (const visibility of ["public", "private"]) {
        const manifest = { ...validManifest, visibility };
        expect(GraphManifestValidator.validate(manifest).isValid).toBe(true);
      }
    });

    // Hue validation
    it("should fail for hue below 0", () => {
      const manifest = { ...validManifest, hue: -1 };
      const result = GraphManifestValidator.validate(manifest);
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain("hue must be between 0 and 360");
    });

    it("should fail for hue above 360", () => {
      const manifest = { ...validManifest, hue: 361 };
      const result = GraphManifestValidator.validate(manifest);
      expect(result.isValid).toBe(false);
    });

    it("should accept hue at boundaries", () => {
      expect(
        GraphManifestValidator.validate({ ...validManifest, hue: 0 }).isValid
      ).toBe(true);
      expect(
        GraphManifestValidator.validate({ ...validManifest, hue: 360 }).isValid
      ).toBe(true);
    });

    // Schema validation
    it("should fail when schema.type is not object", () => {
      const manifest = {
        ...validManifest,
        schema: { type: "array", properties: {}, required: [] },
      };
      const result = GraphManifestValidator.validate(manifest);
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('schema.type must be "object"');
    });

    it("should fail when schema.properties is missing", () => {
      const manifest = {
        ...validManifest,
        schema: { type: "object", required: [] },
      };
      const result = GraphManifestValidator.validate(manifest);
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain("schema.properties must be an object");
    });

    it("should fail when schema.required is not an array", () => {
      const manifest = {
        ...validManifest,
        schema: { type: "object", properties: {}, required: "not-array" },
      };
      const result = GraphManifestValidator.validate(manifest);
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain("schema.required must be an array");
    });

    // Tags validation
    it("should fail for invalid tag format", () => {
      const manifest = { ...validManifest, tags: ["valid", "123invalid"] };
      const result = GraphManifestValidator.validate(manifest);
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain("Invalid tag format: 123invalid");
    });

    it("should fail for duplicate tags", () => {
      const manifest = { ...validManifest, tags: ["chat", "chat"] };
      const result = GraphManifestValidator.validate(manifest);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Duplicate tags found");
    });

    it("should accept valid tags", () => {
      const manifest = {
        ...validManifest,
        tags: ["chat", "simple", "multi-turn"],
      };
      expect(GraphManifestValidator.validate(manifest).isValid).toBe(true);
    });

    // Exception handling
    it("should handle validation exceptions gracefully", () => {
      // Pass something that causes hasOwnProperty to throw
      const result = GraphManifestValidator.validate(null);
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain("Validation error");
    });
  });

  describe("validateOrThrow", () => {
    it("should not throw for valid manifest", () => {
      expect(() => {
        GraphManifestValidator.validateOrThrow(validManifest);
      }).not.toThrow();
    });

    it("should throw with error messages for invalid manifest", () => {
      expect(() => {
        GraphManifestValidator.validateOrThrow({});
      }).toThrow("Graph manifest validation failed");
    });

    it("should include all errors in thrown message", () => {
      try {
        GraphManifestValidator.validateOrThrow({});
      } catch (e: any) {
        expect(e.message).toContain("graphType");
        expect(e.message).toContain("title");
        expect(e.message).toContain("description");
        expect(e.message).toContain("schema");
      }
    });
  });
});

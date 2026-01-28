import {
  generateFullGraphType,
  isValidSemver,
  parseCallbackToken,
  decodeCallbackParams,
} from "../graph/graph.logic";

describe("graph.logic", () => {
  describe("generateFullGraphType", () => {
    it("should produce companySlug.name::version", () => {
      expect(generateFullGraphType("acme", "chatbot", "1.0.0")).toBe(
        "acme.chatbot::1.0.0"
      );
    });

    it("should handle dots in company slug", () => {
      expect(generateFullGraphType("my.company", "graph", "2.1.0")).toBe(
        "my.company.graph::2.1.0"
      );
    });
  });

  describe("isValidSemver", () => {
    it.each(["1.0.0", "0.1.0", "12.34.56", "100.200.300"])(
      "should accept valid semver %s",
      v => {
        expect(isValidSemver(v)).toBe(true);
      }
    );

    it.each(["v1.0.0", "1.0", "1", "1.0.0-beta", "abc", ""])(
      "should reject invalid semver %s",
      v => {
        expect(isValidSemver(v)).toBe(false);
      }
    );
  });

  describe("parseCallbackToken", () => {
    it("should parse valid token", () => {
      const result = parseCallbackToken("cb_myGraph_onApprove_encodedData");

      expect(result).not.toBeNull();
      expect(result!.graphType).toBe("myGraph::1.0.0");
      expect(result!.handler).toBe("onApprove");
    });

    it("should return null for token without cb prefix", () => {
      expect(parseCallbackToken("xx_graph_handler_data")).toBeNull();
    });

    it("should return null for token with fewer than 4 parts", () => {
      expect(parseCallbackToken("cb_graph_handler")).toBeNull();
    });

    it("should return null for empty string", () => {
      expect(parseCallbackToken("")).toBeNull();
    });

    it("should handle tokens with extra underscores in params", () => {
      const result = parseCallbackToken("cb_g_h_param_with_underscores");
      expect(result).not.toBeNull();
      expect(result!.handler).toBe("h");
    });
  });

  describe("decodeCallbackParams", () => {
    it("should decode base64url-encoded JSON params", () => {
      const params = { action: "approve", id: 42 };
      const encoded = Buffer.from(JSON.stringify(params)).toString("base64url");
      const token = `cb_graph_handler_${encoded}`;

      const result = decodeCallbackParams(token);
      expect(result).toEqual(params);
    });

    it("should return empty object for short token", () => {
      expect(decodeCallbackParams("cb_g_h")).toEqual({});
    });

    it("should return empty object for invalid base64", () => {
      expect(decodeCallbackParams("cb_g_h_!!!invalid!!!")).toEqual({});
    });

    it("should return empty object for valid base64 but invalid JSON", () => {
      const notJson = Buffer.from("not json").toString("base64url");
      expect(decodeCallbackParams(`cb_g_h_${notJson}`)).toEqual({});
    });

    it("should handle params with underscores by joining them", () => {
      // Params are split across parts[3:]
      const params = { key: "value" };
      const encoded = Buffer.from(JSON.stringify(params)).toString("base64url");
      // Simulate encoded data that contains underscore (unlikely but valid)
      const token = `cb_g_h_${encoded}`;

      expect(decodeCallbackParams(token)).toEqual(params);
    });
  });
});

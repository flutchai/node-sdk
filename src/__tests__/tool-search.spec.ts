/**
 * Tool search: the model sees `search_tools` + a few core tools, and finds the
 * rest on demand.
 *
 * What these tests pin down:
 *
 *   a) the catalog finds tools by task words (Russian and English endings),
 *      by exact name, and returns nothing for unrelated words
 *   b) the loaded set is read from the history, so no graph keeps extra state
 *   c) Claude: search results become `tool_reference` blocks on the wire, and
 *      deferred tools are sent with `defer_loading: true` (end to end through
 *      ChatAnthropic, with `fetch` stubbed)
 *   d) other models: each turn binds the core tools plus the ones found
 *   e) `ModelInitializer.searchTools` answers from the same catalog the model
 *      was bound with, and below `minTools` nothing changes
 */

const mockLoggerSpies = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

jest.mock("@nestjs/common", () => ({
  Logger: jest.fn().mockImplementation(() => mockLoggerSpies),
}));

// Providers this file does not exercise; their ESM builds do not load under jest.
jest.mock("@langchain/mistralai", () => ({ ChatMistralAI: jest.fn() }));
jest.mock("@langchain/cohere", () => ({
  ChatCohere: jest.fn(),
  CohereRerank: jest.fn(),
}));
jest.mock("../models/rerankers/voyageai-rerank", () => ({
  VoyageAIRerank: jest.fn(),
}));

const mockGetFilteredTools = jest.fn();
jest.mock("../tools/mcp-tool-filter", () => ({
  McpToolFilter: jest.fn().mockImplementation(() => ({
    getFilteredTools: mockGetFilteredTools,
  })),
}));

import { DynamicStructuredTool, StructuredTool } from "@langchain/core/tools";
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { z } from "zod";
import {
  ToolSearchCatalog,
  TOOL_SEARCH_NAME,
  bindToolsWithSearch,
  createToolSearchTool,
  formatToolSearchResult,
  loadedToolNames,
  parseToolSearchResult,
  rewriteToolReferences,
  splitTools,
  toolSearchTerms,
} from "../tools/tool-search";
import { ModelInitializer } from "../models/model.initializer";
import { ModelProvider, ModelType } from "../models/enums";
import { ModelConfigWithTokenAndType } from "../models/model.interface";

function tool(
  name: string,
  description: string,
  params: Record<string, string> = {}
) {
  return new DynamicStructuredTool({
    name,
    description,
    schema: z.object(
      Object.fromEntries(
        Object.entries(params).map(([key, text]) => [
          key,
          z.string().describe(text),
        ])
      )
    ),
    func: async () => "ok",
  });
}

/** A Realytics-like catalog: many similar tools, as in production. */
const TOOLS = [
  tool(
    "rl_find_brands",
    "Find brand_id candidates by name, ranked by store count",
    { name: "Brand name" }
  ),
  tool(
    "rl_define_scope",
    "Define a scope: brands x country x statuses, returns scope_id and cost class"
  ),
  tool(
    "rl_review_overview",
    "CSAT and mention volume for the last 12 months vs the previous 12"
  ),
  tool("rl_review_trend", "CSAT trend over 8 quarters for a scope", {
    scope_id: "Scope id",
  }),
  tool("rl_review_themes", "Top 8 review themes: positive, negative, CSAT"),
  tool("rl_review_quotes", "5 customer review quotes for a theme"),
  tool("rl_store_ranking", "Top and bottom stores by visits, mentions, CSAT"),
  tool(
    "rl_store_profile",
    "Store card: metrics, hourly traffic, opening hours, tourists"
  ),
  tool(
    "rl_brand_competitors",
    "Competitor brands by audience overlap with their CSAT"
  ),
  tool("rl_job_status", "Status of a background job"),
  tool("recipe_create", "Создать рецепт: название, ингредиенты, шаги"),
  tool("funnel_list", "Список воронок компании"),
];

describe("ToolSearchCatalog", () => {
  const catalog = new ToolSearchCatalog(TOOLS);

  it("cuts words to a shared stem across languages and name styles", () => {
    expect(toolSearchTerms("review_trend")).toEqual(
      toolSearchTerms("Review trend")
    );
    expect(toolSearchTerms("отзывы")).toEqual(toolSearchTerms("отзывов"));
    expect(toolSearchTerms("storeRanking")).toEqual(["store", "ranki"]);
  });

  it("finds tools by what they do", () => {
    const names = catalog
      .search("CSAT trend by quarter", 3)
      .map(hit => hit.name);
    expect(names[0]).toBe("rl_review_trend");
  });

  it("finds review quotes from a task description", () => {
    const names = catalog
      .search("customer quotes about a theme", 2)
      .map(hit => hit.name);
    expect(names[0]).toBe("rl_review_quotes");
  });

  it("matches Russian words with other endings", () => {
    expect(catalog.search("создание рецептов", 1)[0].name).toBe(
      "recipe_create"
    );
  });

  it("puts exactly named tools first", () => {
    const names = catalog
      .search("rl_job_status, rl_store_profile", 5)
      .map(hit => hit.name);
    expect(names.slice(0, 2).sort()).toEqual([
      "rl_job_status",
      "rl_store_profile",
    ]);
  });

  it("returns nothing for unrelated words", () => {
    expect(catalog.search("weather forecast", 5)).toEqual([]);
  });

  it("summarises what it covers by name prefix, in a stable order", () => {
    expect(catalog.summary()).toBe("funnel_*, recipe_*, rl_* (10)");
  });
});

describe("search results in the history", () => {
  const found = formatToolSearchResult([
    { name: "rl_review_trend", description: "CSAT trend" },
    { name: "rl_review_quotes", description: "Quotes" },
  ]);

  it("round-trips tool names", () => {
    expect(parseToolSearchResult(found)).toEqual([
      "rl_review_trend",
      "rl_review_quotes",
    ]);
    expect(parseToolSearchResult(formatToolSearchResult([]))).toEqual([]);
    expect(parseToolSearchResult("not json")).toEqual([]);
  });

  it("collects found tools in order, once each", () => {
    const history: BaseMessage[] = [
      new HumanMessage("why did CSAT drop?"),
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "s1", name: TOOL_SEARCH_NAME, args: { query: "csat trend" } },
        ],
      }),
      new ToolMessage({
        content: found,
        tool_call_id: "s1",
        name: TOOL_SEARCH_NAME,
      }),
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "s2", name: TOOL_SEARCH_NAME, args: { query: "quotes" } },
        ],
      }),
      // A graph that does not set `name` on its ToolMessages: matched by call id.
      new ToolMessage({
        content: formatToolSearchResult([
          { name: "rl_review_quotes", description: "" },
          { name: "rl_store_profile", description: "" },
        ]),
        tool_call_id: "s2",
      }),
      new ToolMessage({
        content: found,
        tool_call_id: "other",
        name: "rl_review_trend",
      }),
    ];
    expect(loadedToolNames(history)).toEqual([
      "rl_review_trend",
      "rl_review_quotes",
      "rl_store_profile",
    ]);
  });
});

describe("rewriteToolReferences", () => {
  const body = (resultContent: unknown) =>
    JSON.stringify({
      tools: [
        { name: TOOL_SEARCH_NAME },
        { name: "rl_review_trend", defer_loading: true },
      ],
      messages: [
        { role: "user", content: "why?" },
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "s1",
              name: TOOL_SEARCH_NAME,
              input: { query: "trend" },
            },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "s1", content: resultContent },
          ],
        },
      ],
    });

  it("replaces a search result with tool_reference blocks only", () => {
    const text = formatToolSearchResult([
      { name: "rl_review_trend", description: "" },
      { name: "rl_unknown", description: "" },
    ]);
    const rewritten = JSON.parse(rewriteToolReferences(body(text)));
    expect(rewritten.messages[2].content[0].content).toEqual([
      { type: "tool_reference", tool_name: "rl_review_trend" },
    ]);
  });

  it("reads results LangChain sent as text blocks", () => {
    const text = formatToolSearchResult([
      { name: "rl_review_trend", description: "" },
    ]);
    const rewritten = JSON.parse(
      rewriteToolReferences(body([{ type: "text", text }]))
    );
    expect(rewritten.messages[2].content[0].content).toEqual([
      { type: "tool_reference", tool_name: "rl_review_trend" },
    ]);
  });

  it("leaves a search that found nothing as text", () => {
    const original = body(formatToolSearchResult([]));
    expect(rewriteToolReferences(original)).toBe(original);
  });

  it("returns the same string when there is no search", () => {
    const original = JSON.stringify({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(rewriteToolReferences(original)).toBe(original);
  });
});

describe("bindToolsWithSearch (rebind)", () => {
  /** A model whose bindTools records the names it was given. */
  function fakeModel() {
    const bound: string[][] = [];
    const model = {
      bindTools: (tools: StructuredTool[]) => {
        bound.push(tools.map(t => t.name));
        return { invoke: async () => new AIMessage("done") };
      },
    } as unknown as BaseChatModel;
    return { model, bound };
  }

  it("binds the core tools plus the ones the history has found", async () => {
    const { model, bound } = fakeModel();
    const { core, deferred } = splitTools(TOOLS, {
      alwaysLoaded: ["rl_find_brands", "rl_define_scope"],
    });
    const searchTool = createToolSearchTool(new ToolSearchCatalog(deferred));
    const runnable = bindToolsWithSearch({
      model,
      core,
      deferred,
      searchTool,
      mode: "rebind",
    });

    await runnable.invoke([new HumanMessage("hi")]);
    expect(bound[0]).toEqual([
      "rl_find_brands",
      "rl_define_scope",
      TOOL_SEARCH_NAME,
    ]);

    await runnable.invoke([
      new HumanMessage("hi"),
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "s1", name: TOOL_SEARCH_NAME, args: { query: "x" } },
        ],
      }),
      new ToolMessage({
        content: formatToolSearchResult([
          { name: "rl_review_trend", description: "" },
          { name: "not_mine", description: "" },
        ]),
        tool_call_id: "s1",
        name: TOOL_SEARCH_NAME,
      }),
    ]);
    expect(bound[1]).toEqual([
      "rl_find_brands",
      "rl_define_scope",
      TOOL_SEARCH_NAME,
      "rl_review_trend",
    ]);
  });

  it("accepts always-loaded names as a comma-separated string", () => {
    const { core } = splitTools(TOOLS, {
      alwaysLoaded: " rl_find_brands, rl_define_scope ,",
    });
    expect(core.map(t => t.name)).toEqual([
      "rl_find_brands",
      "rl_define_scope",
    ]);
  });

  it("the search tool answers from the catalog", async () => {
    const searchTool = createToolSearchTool(new ToolSearchCatalog(TOOLS), 2);
    expect(searchTool.description).toContain("rl_* (10)");
    const answer = await searchTool.invoke({
      query: "store ranking by visits",
    });
    expect(parseToolSearchResult(answer)[0]).toBe("rl_store_ranking");
  });
});

describe("ModelInitializer with toolSearch", () => {
  const fetchSpy = jest.spyOn(globalThis, "fetch");
  const mockFetcher = jest.fn();

  function anthropicConfig(): ModelConfigWithTokenAndType {
    return {
      modelId: "model-claude",
      modelName: "claude-sonnet-4-6",
      provider: ModelProvider.ANTHROPIC,
      modelType: ModelType.CHAT,
      defaultMaxTokens: 1024,
      requiresApiKey: true,
      apiToken: "test-key",
    } as ModelConfigWithTokenAndType;
  }

  const TOOLS_CONFIG = TOOLS.map(t => ({ toolName: t.name, enabled: true }));
  const SEARCH = { enabled: true, alwaysLoaded: ["rl_find_brands"] };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFilteredTools.mockResolvedValue(TOOLS);
    mockFetcher.mockResolvedValue(anthropicConfig());
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
  });

  afterAll(() => fetchSpy.mockRestore());

  it("Claude: defers the rest, and sends found tools as tool_reference blocks", async () => {
    const initializer = new ModelInitializer(mockFetcher);
    const config = {
      modelId: "model-claude",
      toolsConfig: TOOLS_CONFIG,
      toolSearch: { ...SEARCH, minTools: 5 },
    };
    const model = await initializer.initializeChatModel(config);

    const search = await initializer.searchTools(config, {
      query: "CSAT trend by quarter",
    });
    expect(parseToolSearchResult(search.content)[0]).toBe("rl_review_trend");

    await model.invoke([
      new HumanMessage("why did CSAT drop?"),
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "toolu_1", name: TOOL_SEARCH_NAME, args: { query: "csat" } },
        ],
      }),
      new ToolMessage({
        content: search.content,
        tool_call_id: "toolu_1",
        name: TOOL_SEARCH_NAME,
      }),
    ]);

    const sent = JSON.parse(
      String((fetchSpy.mock.calls[0][1] as RequestInit).body)
    );
    const byName = Object.fromEntries(
      sent.tools.map((t: { name: string }) => [t.name, t])
    );
    expect(byName[TOOL_SEARCH_NAME].defer_loading).toBeUndefined();
    expect(byName.rl_find_brands.defer_loading).toBeUndefined();
    expect(byName.rl_review_trend.defer_loading).toBe(true);
    expect(sent.tools).toHaveLength(TOOLS.length + 1);

    const result = sent.messages[2].content[0];
    expect(result.type).toBe("tool_result");
    expect(result.content[0]).toEqual({
      type: "tool_reference",
      tool_name: "rl_review_trend",
    });
    expect(
      result.content.every(
        (block: { type: string }) => block.type === "tool_reference"
      )
    ).toBe(true);
  });

  it("keeps the request byte-identical when tool search is off or the agent has few tools", async () => {
    const initializer = new ModelInitializer(mockFetcher);
    const model = await initializer.initializeChatModel({
      modelId: "model-claude",
      toolsConfig: TOOLS_CONFIG,
      toolSearch: { ...SEARCH, minTools: 50 },
    });
    await model.invoke([new HumanMessage("hi")]);
    const sent = JSON.parse(
      String((fetchSpy.mock.calls[0][1] as RequestInit).body)
    );
    expect(sent.tools.map((t: { name: string }) => t.name)).toEqual(
      TOOLS.map(t => t.name)
    );
    expect(
      sent.tools.some((t: { defer_loading?: boolean }) => t.defer_loading)
    ).toBe(false);

    const search = await initializer.searchTools(
      {
        modelId: "model-claude",
        toolsConfig: TOOLS_CONFIG,
        toolSearch: { ...SEARCH, minTools: 50 },
      },
      { query: "trend" }
    );
    expect(search.success).toBe(false);
  });

  it("rebuilds the catalog for a search on a fresh instance (another pod)", async () => {
    const config = {
      modelId: "model-claude",
      toolsConfig: TOOLS_CONFIG,
      toolSearch: { ...SEARCH, minTools: 5 },
    };
    const search = await new ModelInitializer(mockFetcher).searchTools(config, {
      query: "store opening hours",
    });
    expect(parseToolSearchResult(search.content)[0]).toBe("rl_store_profile");
  });
});

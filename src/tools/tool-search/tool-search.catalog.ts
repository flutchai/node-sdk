import type { StructuredToolInterface } from "@langchain/core/tools";

/** One tool as the search sees it: its name, description and argument names. */
export interface ToolSearchEntry {
  name: string;
  description: string;
  /** Argument names and their descriptions, flattened. */
  params: string[];
}

/** A search hit: what the model reads about a tool it can now call. */
export interface ToolSearchHit {
  name: string;
  description: string;
}

/**
 * BM25 parameters. k1 dampens repeated terms, b normalises for long
 * descriptions — the usual values; tool texts are short, so they are not
 * worth tuning.
 */
const K1 = 1.2;
const B = 0.75;
/** A name word counts this many times: `review_quotes` is about quotes. */
const NAME_WEIGHT = 3;
/** Words are cut to this many characters, so "отзывы" and "отзывов" meet. */
const STEM_LENGTH = 5;
/** What the model reads about a hit: the description's start, not all of it. */
const HIT_DESCRIPTION_CHARS = 240;

/**
 * Words of a text, lowercased and cut to a crude stem.
 *
 * Splits on anything that is not a letter or digit (so `rl_review_trend`
 * and "review trend" give the same words) and on camelCase. Cutting every
 * word to its first five characters is a poor man's stemmer that works for
 * both Russian and English endings without a dictionary.
 */
export function toolSearchTerms(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(word => word.length > 1)
    .map(word => word.slice(0, STEM_LENGTH));
}

/** Argument names and descriptions of a tool's schema (JSON Schema or zod). */
function schemaParams(schema: unknown): string[] {
  const json = schema as {
    properties?: Record<string, { description?: string }>;
    shape?: Record<string, { description?: string }>;
  };
  const properties = json?.properties ?? json?.shape ?? {};
  return Object.entries(properties).flatMap(([name, property]) =>
    property?.description ? [name, property.description] : [name]
  );
}

/** The first sentence or so of a description — enough to choose by. */
function shortDescription(description: string): string {
  const flat = description.replace(/\s+/g, " ").trim();
  if (flat.length <= HIT_DESCRIPTION_CHARS) return flat;
  const cut = flat.slice(0, HIT_DESCRIPTION_CHARS);
  const sentenceEnd = cut.lastIndexOf(". ");
  return sentenceEnd > HIT_DESCRIPTION_CHARS / 2
    ? cut.slice(0, sentenceEnd + 1)
    : `${cut.trimEnd()}…`;
}

/** What an index line says about a tool: its first sentence, kept short. */
const INDEX_DESCRIPTION_CHARS = 100;

function indexDescription(description: string): string {
  const flat = description.replace(/\s+/g, " ").trim();
  const sentenceEnd = flat.search(/[.!?](\s|$)/);
  const sentence = sentenceEnd >= 0 ? flat.slice(0, sentenceEnd) : flat;
  return sentence.length <= INDEX_DESCRIPTION_CHARS
    ? sentence
    : `${sentence.slice(0, INDEX_DESCRIPTION_CHARS).trimEnd()}…`;
}

/**
 * The tools an agent can find but does not see up front, and a BM25 search
 * over their names, descriptions and argument names.
 *
 * Built once per bound tool set (it is cheap: tens to hundreds of short
 * texts) and kept next to the model instance that uses it.
 */
export class ToolSearchCatalog {
  private readonly entries: ToolSearchEntry[];
  private readonly documents: Map<string, number>[];
  private readonly lengths: number[];
  private readonly averageLength: number;
  private readonly documentFrequency = new Map<string, number>();

  constructor(
    tools: Pick<StructuredToolInterface, "name" | "description" | "schema">[]
  ) {
    this.entries = tools.map(tool => ({
      name: tool.name,
      description: tool.description ?? "",
      params: schemaParams(tool.schema),
    }));
    this.documents = this.entries.map(entry => {
      const nameTerms = toolSearchTerms(entry.name);
      const terms = [
        ...Array.from({ length: NAME_WEIGHT }, () => nameTerms).flat(),
        ...toolSearchTerms(entry.description),
        ...entry.params.flatMap(toolSearchTerms),
      ];
      const counts = new Map<string, number>();
      for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
      return counts;
    });
    this.lengths = this.documents.map(counts =>
      Array.from(counts.values()).reduce((sum, n) => sum + n, 0)
    );
    this.averageLength =
      this.lengths.reduce((sum, n) => sum + n, 0) /
      Math.max(this.lengths.length, 1);
    for (const counts of this.documents) {
      for (const term of counts.keys()) {
        this.documentFrequency.set(
          term,
          (this.documentFrequency.get(term) ?? 0) + 1
        );
      }
    }
  }

  get size(): number {
    return this.entries.length;
  }

  has(name: string): boolean {
    return this.entries.some(entry => entry.name === name);
  }

  /**
   * The best `limit` tools for a query, best first. A query that names a tool
   * exactly returns that tool first whatever its score. Tools that share no
   * word with the query are never returned.
   */
  search(query: string, limit: number): ToolSearchHit[] {
    const terms = Array.from(new Set(toolSearchTerms(query)));
    const exact = query
      .split(/[\s,]+/)
      .map(word => word.trim())
      .filter(word => this.has(word));
    const total = this.entries.length;

    const scored = this.entries
      .map((entry, index) => {
        const counts = this.documents[index];
        const length = this.lengths[index];
        let score = 0;
        for (const term of terms) {
          const frequency = counts.get(term);
          if (!frequency) continue;
          const df = this.documentFrequency.get(term) ?? 0;
          const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
          score +=
            (idf * frequency * (K1 + 1)) /
            (frequency + K1 * (1 - B + (B * length) / this.averageLength));
        }
        if (exact.includes(entry.name)) score += 1000;
        return { entry, score };
      })
      .filter(({ score }) => score > 0)
      // Ties keep catalog order, so the same query always returns the same list.
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, Math.max(1, limit)).map(({ entry }) => ({
      name: entry.name,
      description: shortDescription(entry.description),
    }));
  }

  /**
   * Every tool of the catalog on its own line: its name and the start of its
   * description. Costs a few tokens per tool instead of a full schema, and
   * lets the model ask for a tool by its exact name.
   */
  index(): string {
    return this.entries
      .map(entry => {
        const brief = indexDescription(entry.description);
        return brief ? `- ${entry.name}: ${brief}` : `- ${entry.name}`;
      })
      .join("\n");
  }

  /**
   * What the catalog covers, as name prefixes with counts:
   * "funnel_* (4), recipe_* (5), rl_* (41)". Goes into the search tool's
   * description so the model knows a search is worth making. Sorted, so the
   * description — and the prompt cache — stays the same between requests.
   */
  summary(maxGroups = 20): string {
    const groups = new Map<string, number>();
    for (const entry of this.entries) {
      const prefix = entry.name.includes("_")
        ? `${entry.name.split("_")[0]}_*`
        : entry.name;
      groups.set(prefix, (groups.get(prefix) ?? 0) + 1);
    }
    const sorted = Array.from(groups.entries()).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    const shown = sorted
      .slice(0, maxGroups)
      .map(([prefix, count]) => (count > 1 ? `${prefix} (${count})` : prefix));
    return sorted.length > maxGroups
      ? `${shown.join(", ")}, …`
      : shown.join(", ");
  }
}

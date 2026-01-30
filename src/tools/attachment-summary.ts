import { IGraphAttachment } from "./mcp.interfaces";

const MAX_SAMPLE_ROWS = 5;
const MAX_TEXT_PREVIEW_LENGTH = 500;

/**
 * Generates a summary string for large tool results.
 * Automatically detects format: tabular (array of objects) vs text.
 *
 * Defensive: does not throw on edge cases (nested objects, circular refs, etc.).
 */
export function generateAttachmentSummary(
  data: any,
  toolCallId: string
): string {
  try {
    if (Array.isArray(data) && data.length > 0 && isTabular(data)) {
      return generateTabularSummary(data, toolCallId);
    }
    return generateTextSummary(data, toolCallId);
  } catch {
    return `[Data stored as attachment: ${toolCallId}]`;
  }
}

/**
 * Creates an IGraphAttachment from tool result data.
 */
export function createGraphAttachment(
  data: any,
  toolName: string,
  toolCallId: string
): IGraphAttachment {
  return {
    data,
    summary: generateAttachmentSummary(data, toolCallId),
    toolName,
    toolCallId,
    createdAt: Date.now(),
  };
}

function isTabular(data: any[]): boolean {
  const first = data[0];
  return first !== null && typeof first === "object" && !Array.isArray(first);
}

function generateTabularSummary(data: any[], toolCallId: string): string {
  const rowCount = data.length;
  const columns = Object.keys(data[0]);
  const sampleRows = data.slice(0, MAX_SAMPLE_ROWS);

  const rowLabel = rowCount === 1 ? "row" : "rows";
  const colLabel = columns.length === 1 ? "column" : "columns";
  let summary = `${rowCount} ${rowLabel}, ${columns.length} ${colLabel} (${columns.join(", ")})\n`;
  summary += `Sample data:\n`;

  for (const row of sampleRows) {
    try {
      summary += JSON.stringify(row) + "\n";
    } catch {
      summary += "[unserializable row]\n";
    }
  }

  summary += `[Data stored as attachment: ${toolCallId}]`;
  return summary;
}

function generateTextSummary(data: any, toolCallId: string): string {
  let text: string;
  try {
    text = typeof data === "string" ? data : JSON.stringify(data);
  } catch {
    text = String(data);
  }

  const preview = text.slice(0, MAX_TEXT_PREVIEW_LENGTH);
  const suffix = text.length > MAX_TEXT_PREVIEW_LENGTH ? "..." : "";

  let summary = `${text.length} characters\n`;
  summary += `Preview: ${preview}${suffix}\n`;
  summary += `[Data stored as attachment: ${toolCallId}]`;
  return summary;
}

/**
 * Simple in-memory usage recorder for tracking model executions
 */
export class UsageRecorder {
  private modelCalls: Array<{
    modelId: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    timestamp: string;
    [key: string]: any;
  }> = [];

  recordModelExecution(record: {
    modelId: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens?: number;
    [key: string]: any;
  }): void {
    const totalTokens =
      record.totalTokens ?? record.promptTokens + record.completionTokens;
    this.modelCalls.push({
      ...record,
      totalTokens,
      timestamp: new Date().toISOString(),
    });
  }

  getRecords(): {
    modelCalls: Array<{
      modelId: string;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      timestamp: string;
      [key: string]: any;
    }>;
  } {
    return {
      modelCalls: [...this.modelCalls],
    };
  }

  clear(): void {
    this.modelCalls = [];
  }

  getTotalTokens(): number {
    return this.modelCalls.reduce((sum, call) => sum + call.totalTokens, 0);
  }

  getTotalCalls(): number {
    return this.modelCalls.length;
  }
}

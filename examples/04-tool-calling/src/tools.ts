import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * Calculator tool - performs basic math operations
 */
export const calculatorTool = new DynamicStructuredTool({
  name: "calculator",
  description:
    "Performs basic mathematical calculations. Use this for any math operations.",
  schema: z.object({
    operation: z
      .enum(["add", "subtract", "multiply", "divide"])
      .describe("The math operation to perform"),
    a: z.number().describe("First number"),
    b: z.number().describe("Second number"),
  }),
  func: async ({ operation, a, b }) => {
    let result: number;

    switch (operation) {
      case "add":
        result = a + b;
        break;
      case "subtract":
        result = a - b;
        break;
      case "multiply":
        result = a * b;
        break;
      case "divide":
        if (b === 0) {
          return "Error: Division by zero";
        }
        result = a / b;
        break;
    }

    return `${a} ${operation} ${b} = ${result}`;
  },
});

/**
 * Weather tool - returns mock weather data
 */
export const weatherTool = new DynamicStructuredTool({
  name: "get_weather",
  description:
    "Get the current weather for a location. Use this when asked about weather.",
  schema: z.object({
    location: z.string().describe("The city or location to get weather for"),
    unit: z
      .enum(["celsius", "fahrenheit"])
      .default("celsius")
      .describe("Temperature unit"),
  }),
  func: async ({ location, unit }) => {
    // Mock weather data
    const mockWeather = {
      temperature: unit === "celsius" ? 22 : 72,
      condition: "Partly cloudy",
      humidity: 65,
      wind: "12 km/h",
    };

    return JSON.stringify({
      location,
      ...mockWeather,
      unit,
    });
  },
});

/**
 * Time tool - returns current time
 */
export const timeTool = new DynamicStructuredTool({
  name: "get_current_time",
  description:
    "Get the current date and time. Use this when asked about the current time or date.",
  schema: z.object({
    timezone: z
      .string()
      .default("UTC")
      .describe("Timezone (e.g., UTC, America/New_York, Europe/London)"),
  }),
  func: async ({ timezone }) => {
    const now = new Date();

    try {
      const formatted = now.toLocaleString("en-US", {
        timeZone: timezone,
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      return `Current time in ${timezone}: ${formatted}`;
    } catch {
      return `Current time (UTC): ${now.toISOString()}`;
    }
  },
});

// Export all tools as array
export const tools = [calculatorTool, weatherTool, timeTool];

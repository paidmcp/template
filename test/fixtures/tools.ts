// Test-only tool set, swapped in for src/tools.ts by test/harness.ts.
import { z } from "zod";

export interface PaidTool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  priceUsdt: number;
  inputSchema: z.ZodTypeAny;
  handler: (input: TInput) => Promise<TOutput>;
}

export const tools: PaidTool<any, any>[] = [
  {
    name: "echo",
    description: "Echoes the message.",
    priceUsdt: 0.001,
    inputSchema: z.object({ message: z.string() }),
    handler: async (input: { message: string }) => ({ echoed: input.message }),
  },
  {
    name: "fail",
    description: "Always throws.",
    priceUsdt: 0.001,
    inputSchema: z.object({}),
    handler: async () => {
      throw new Error("upstream unavailable");
    },
  },
  {
    name: "slow",
    description: "Waits, then echoes.",
    priceUsdt: 0.001,
    inputSchema: z.object({ message: z.string() }),
    handler: async (input: { message: string }) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return { echoed: input.message };
    },
  },
];

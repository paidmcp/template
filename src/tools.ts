import { z } from "zod";

export interface PaidTool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  priceUsdt: number;
  inputSchema: z.ZodTypeAny;
  handler: (input: TInput) => Promise<TOutput>;
}

export function definePaidTool<TInput, TOutput>(
  tool: PaidTool<TInput, TOutput>
): PaidTool<TInput, TOutput> {
  return tool;
}

export const tools: Array<PaidTool<any, any>> = [
  definePaidTool({
    name: "echo",
    description: "Echoes input back for payment flow testing.",
    priceUsdt: 0.001,
    inputSchema: z.object({
      message: z.string().describe("The message to echo back")
    }),
    handler: async (input) => ({
      echoed: input.message,
      timestamp: new Date().toISOString()
    })
  })
];

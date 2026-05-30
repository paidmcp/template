import express from "express";
import { paymentMiddleware } from "@x402/express";
import { z } from "zod";
import { config } from "./config.js";
import { logCall } from "./log.js";
import { buildResourceServer, buildRoutes } from "./payments.js";
import { tools } from "./tools.js";
import { getReceiverAddress } from "./wallet.js";

const app = express();
app.use(express.json({ limit: "100kb" }));

const sellerAddress = await getReceiverAddress();
const resourceServer = buildResourceServer(tools);
app.use(paymentMiddleware(buildRoutes(tools, sellerAddress), resourceServer));

for (const tool of tools) {
  app.post(`/tools/${tool.name}`, async (req, res) => {
    try {
      const input = tool.inputSchema.parse(req.body);
      const result = await tool.handler(input);
      // Successful paid calls are logged in the onAfterSettle hook (with tx hash).
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logCall({ toolName: tool.name, success: false, errorMessage: message });
      res.status(500).json({ error: message });
    }
  });
}

app.get("/mcp/tools", (_req, res) => {
  res.json({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: z.toJSONSchema(tool.inputSchema),
      priceUsdt: tool.priceUsdt
    }))
  });
});

app.listen(config.PORT, () => {
  console.log(`PaidMCP template running on http://localhost:${config.PORT}`);
  console.log(`Receiver (Base + Plasma): ${sellerAddress}`);
});

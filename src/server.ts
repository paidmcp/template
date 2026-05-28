import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { HTTPFacilitatorClient, type RoutesConfig } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { z } from "zod";
import { config } from "./config.js";
import { logCall } from "./log.js";
import { tools } from "./tools.js";
import { getReceiverAddress } from "./wallet.js";

const app = express();
app.use(express.json());

const sellerAddress = await getReceiverAddress();
const facilitatorClient = new HTTPFacilitatorClient({ url: config.FACILITATOR_URL });
const networkId = config.NETWORK_ID as `${string}:${string}`;
const resourceServer = new x402ResourceServer(facilitatorClient).register(networkId, new ExactEvmScheme());

const middlewareConfig: RoutesConfig = {};
for (const tool of tools) {
  middlewareConfig[`POST /tools/${tool.name}`] = {
    accepts: {
      scheme: "exact",
      network: networkId,
      price: `$${tool.priceUsdt.toFixed(3)}`,
      payTo: sellerAddress as `0x${string}`
    },
    description: tool.description,
    mimeType: "application/json"
  };
}

app.use(paymentMiddleware(middlewareConfig, resourceServer));

for (const tool of tools) {
  app.post(`/tools/${tool.name}`, async (req, res) => {
    try {
      const input = tool.inputSchema.parse(req.body);
      const result = await tool.handler(input);
      logCall({ toolName: tool.name, amountUsdt: tool.priceUsdt, success: true });
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logCall({ toolName: tool.name, success: false, errorMessage: message });
      res.status(500).json({ error: message });
    }
  });
}

const mcp = new Server({ name: "paidmcp-template", version: "0.1.0" }, { capabilities: { tools: {} } });

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((tool) => ({
    name: tool.name,
    description: `${tool.description}\n\nPrice: $${tool.priceUsdt} USDT per call`,
    inputSchema: z.toJSONSchema(tool.inputSchema)
  }))
}));

mcp.setRequestHandler(CallToolRequestSchema, async (request) => ({
  isError: true,
  content: [
    {
      type: "text",
      text: `This tool requires x402 payment via HTTP route POST /tools/${request.params.name}. Use paidmcp-client to auto-pay and retry.`
    }
  ]
}));

const transports = new Map<string, SSEServerTransport>();
app.get("/sse", async (_req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports.set(transport.sessionId, transport);
  res.on("close", () => transports.delete(transport.sessionId));
  await mcp.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(400).send("No session transport found");
    return;
  }
  await transport.handlePostMessage(req, res);
});

app.get("/mcp/tools", async (_req, res) => {
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
  console.log(`MCP SSE: http://localhost:${config.PORT}/sse`);
  console.log(`Receiver: ${sellerAddress}`);
});

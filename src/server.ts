import { randomUUID } from "node:crypto";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { paymentMiddleware } from "@x402/express";
import { z } from "zod";
import { config } from "./config.js";
import { getTrialCallsUsedByPayer, logCall } from "./log.js";
import { buildResourceServer, buildRoutes } from "./payments.js";
import { tools } from "./tools.js";
import { getReceiverAddress } from "./wallet.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
const sellerAddress = await getReceiverAddress();
const resourceServer = buildResourceServer(tools);
const toolPaymentMiddleware = paymentMiddleware(
  buildRoutes(tools, sellerAddress),
  resourceServer,
);

type SessionState = {
  transport: StreamableHTTPServerTransport;
  server: Server;
};
const sessions: Record<string, SessionState> = {};

app.post("/mcp", async (req, res) => {
  try {
    const canContinue = await enforcePaymentForToolCalls(req, res);
    if (!canContinue) return;

    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport | undefined;

    if (sessionId && sessions[sessionId]) {
      transport = sessions[sessionId].transport;
    } else if (!sessionId && isInitializeRequest(req.body)) {
      const createdServer = createMcpServer();
      const createdTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          sessions[sid] = {
            transport: createdTransport,
            server: createdServer,
          };
        },
      });
      transport = createdTransport;
      createdTransport.onclose = () => {
        const sid = createdTransport.sessionId;
        if (sid) {
          const session = sessions[sid];
          if (session) {
            void session.server.close().catch(() => undefined);
            delete sessions[sid];
          }
        }
      };
      await createdServer.connect(createdTransport);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: missing valid MCP session",
        },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP POST error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await sessions[sessionId].transport.handleRequest(req, res);
});

app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await sessions[sessionId].transport.handleRequest(req, res);
});

app.get("/mcp/tools", (_req, res) => {
  res.json({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: z.toJSONSchema(tool.inputSchema),
      priceUsdt: tool.priceUsdt,
    })),
  });
});

app.listen(config.PORT, () => {
  console.log(`PaidMCP template running on http://localhost:${config.PORT}`);
  console.log(
    `Mode: ${config.NETWORK_MODE} | free trial calls per payer: ${config.FREE_TRIAL_CALLS}`,
  );
  console.log(`Receiver (Base + Plasma): ${sellerAddress}`);
});

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const value = headers[key] ?? headers[key.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function hasAnyHeader(
  headers: Record<string, string | string[] | undefined>,
  keys: string[],
): boolean {
  return keys.some((key) => Boolean(getHeader(headers, key)));
}

function createMcpServer(): Server {
  const mcp = new Server(
    { name: "paidmcp-template", version: "0.2.0" },
    { capabilities: { tools: {} } },
  );

  mcp.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: z.toJSONSchema(tool.inputSchema),
        _meta: { priceUsdt: tool.priceUsdt },
      })),
    };
  });

  mcp.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const tool = toolByName.get(request.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [
          { type: "text", text: `Unknown tool: ${request.params.name}` },
        ],
      };
    }

    const headers = extra.requestInfo?.headers ?? {};
    const payer = getHeader(headers, "x-paidmcp-payer");
    const isTrial = getHeader(headers, "x-paidmcp-trial") === "1";
    const wasPaid = hasAnyHeader(headers, ["payment-signature", "x-payment"]);

    try {
      const input = tool.inputSchema.parse(request.params.arguments ?? {});
      const result = await tool.handler(input);

      if (isTrial && payer) {
        logCall({
          toolName: tool.name,
          payerAddress: payer,
          amountUsdt: 0,
          success: true,
          isTrial: true,
        });
      }

      return {
        structuredContent: result as Record<string, unknown>,
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (!wasPaid || isTrial) {
        logCall({
          toolName: tool.name,
          payerAddress: payer,
          success: false,
          isTrial,
          errorMessage: message,
        });
      }
      return { isError: true, content: [{ type: "text", text: message }] };
    }
  });

  return mcp;
}

function runMiddleware(
  req: Request,
  res: Response,
  middleware: (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => void | Promise<void>,
) {
  return new Promise<void>((resolve, reject) => {
    middleware(req, res, (err?: unknown) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function enforcePaymentForToolCalls(
  req: Request,
  res: Response,
): Promise<boolean> {
  const body = req.body as
    | { method?: string; params?: { name?: string } }
    | undefined;
  if (body?.method !== "tools/call") return true;

  const toolName = body.params?.name;
  if (!toolName || !toolByName.has(toolName)) return true;
  const tool = toolByName.get(toolName);

  // Validate input before payment so malformed calls are never charged.
  if (tool) {
    const parsed = tool.inputSchema.safeParse(
      (body.params as { arguments?: unknown } | undefined)?.arguments ?? {},
    );
    if (!parsed.success) {
      return true;
    }
  }

  const payerHeader =
    getHeader(req.headers, "x402-payer") ??
    getHeader(req.headers, "x-payment-payer");
  const payer = payerHeader ?? `ip:${req.ip || "unknown"}`;
  if (payer) {
    const used = getTrialCallsUsedByPayer(payer);
    if (used < config.FREE_TRIAL_CALLS) {
      req.headers["x-paidmcp-payer"] = payer;
      req.headers["x-paidmcp-trial"] = "1";
      res.setHeader(
        "x-paidmcp-trial-remaining",
        String(config.FREE_TRIAL_CALLS - used - 1),
      );
      return true;
    }
  }

  req.headers["x-paidmcp-trial"] = "0";
  req.headers["x-paidmcp-payer"] = payer;

  const originalUrl = req.url;
  req.url = `/tools/${toolName}`;
  try {
    await runMiddleware(
      req,
      res,
      toolPaymentMiddleware as unknown as (
        req: Request,
        res: Response,
        next: NextFunction,
      ) => void,
    );
  } finally {
    req.url = originalUrl;
  }

  return !res.headersSent;
}

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import express, { type Request, type Response } from "express";
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
import {
  getTrialCallsUsedByPayer,
  logCall,
  refundTrialCall,
  reserveTrialCall,
} from "./log.js";
import { buildResourceServer, buildRoutes } from "./payments.js";
import { tools, type PaidTool } from "./tools.js";
import { getReceiverAddress } from "./wallet.js";

const app = express();
app.disable("x-powered-by");
// Needed for a correct req.ip (used for trial limits) behind Fly/Railway.
app.set("trust proxy", config.TRUST_PROXY);

// Only a real application/json body is parsed. Anything else leaves req.body
// undefined and is rejected below, so the payment check and the MCP transport
// always see the same single, size-limited message.
const jsonBody = express.json({ limit: "1mb", type: "application/json" });

const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
const sellerAddress = await getReceiverAddress();
const resourceServer = buildResourceServer(tools);
const toolPaymentMiddleware = paymentMiddleware(
  buildRoutes(tools, sellerAddress),
  resourceServer,
);

/**
 * Per-request state shared with the tool handler. It lives in server memory
 * (AsyncLocalStorage), never in request headers, so clients cannot forge it.
 */
type CallContext = {
  res: Response;
  trialCallId: number | null;
  paid: boolean;
};
const callContext = new AsyncLocalStorage<CallContext>();

/** Payment signatures currently in use, so one payment runs one call. */
const inFlightPayments = new Set<string>();

type SessionState = {
  transport: StreamableHTTPServerTransport;
  server: Server;
  lastSeen: number;
};
const sessions = new Map<string, SessionState>();

type JsonRpcMessage = {
  jsonrpc?: string;
  method?: string;
  params?: { name?: unknown; arguments?: unknown };
};

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/mcp", jsonBody, async (req, res) => {
  try {
    const body: unknown = req.body;
    if (body === undefined || body === null || typeof body !== "object") {
      res
        .status(415)
        .json(
          rpcError(
            -32700,
            "Expected a JSON-RPC message with Content-Type: application/json",
          ),
        );
      return;
    }
    if (Array.isArray(body)) {
      res
        .status(400)
        .json(rpcError(-32600, "Batch requests are not supported"));
      return;
    }
    const message = body as JsonRpcMessage;

    const sessionId = req.get("mcp-session-id");
    let transport: StreamableHTTPServerTransport;
    if (sessionId) {
      const session = sessions.get(sessionId);
      if (!session) {
        res.status(404).json(rpcError(-32001, "Session not found"));
        return;
      }
      session.lastSeen = Date.now();
      transport = session.transport;
    } else if (isInitializeRequest(message)) {
      if (sessions.size >= config.MAX_SESSIONS) {
        closeIdleSessions();
      }
      if (sessions.size >= config.MAX_SESSIONS) {
        res.status(503).json(rpcError(-32000, "Server is at capacity"));
        return;
      }
      transport = await createSession();
    } else {
      res
        .status(400)
        .json(rpcError(-32000, "Bad Request: missing valid MCP session"));
      return;
    }

    const ctx: CallContext = { res, trialCallId: null, paid: false };
    if (message.method === "tools/call") {
      const proceed = await gateToolCall(req, res, message, ctx);
      if (!proceed) return;
    }

    await callContext.run(ctx, () =>
      transport.handleRequest(req, res, message),
    );
  } catch (error) {
    console.error("MCP POST error:", error);
    if (!res.headersSent) {
      res.status(500).json(rpcError(-32603, "Internal server error"));
    }
  }
});

app.get("/mcp", async (req, res) => {
  const session = sessions.get(req.get("mcp-session-id") ?? "");
  if (!session) {
    res.status(404).send("Session not found");
    return;
  }
  session.lastSeen = Date.now();
  await session.transport.handleRequest(req, res);
});

app.delete("/mcp", async (req, res) => {
  const session = sessions.get(req.get("mcp-session-id") ?? "");
  if (!session) {
    res.status(404).send("Session not found");
    return;
  }
  await session.transport.handleRequest(req, res);
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

setInterval(closeIdleSessions, 60_000).unref();

app.listen(config.PORT, () => {
  console.log(`PaidMCP template running on http://localhost:${config.PORT}`);
  console.log(
    `Mode: ${config.NETWORK_MODE} | free trial calls per client IP: ${config.FREE_TRIAL_CALLS}`,
  );
  console.log(`Receiver (Base + Plasma): ${sellerAddress}`);
});

/**
 * Decides how a tools/call is paid for. Returns true when the call may run
 * (free trial, valid payment, or a call that will be rejected without running
 * a tool), or false when a response (402, 409, ...) was already sent.
 */
async function gateToolCall(
  req: Request,
  res: Response,
  message: JsonRpcMessage,
  ctx: CallContext,
): Promise<boolean> {
  const name = message.params?.name;
  const tool = typeof name === "string" ? toolByName.get(name) : undefined;
  // Unknown tools and invalid input are rejected by the handler before any
  // tool code runs, so they are never charged and never use a trial call.
  if (!tool) return true;
  if (!tool.inputSchema.safeParse(message.params?.arguments ?? {}).success) {
    return true;
  }

  const paymentHeader = req.get("payment-signature") ?? req.get("x-payment");

  if (!paymentHeader) {
    const trialKey = `ip:${req.ip ?? "unknown"}`;
    const trialCallId = reserveTrialCall(
      trialKey,
      tool.name,
      config.FREE_TRIAL_CALLS,
    );
    if (trialCallId !== null) {
      ctx.trialCallId = trialCallId;
      res.setHeader(
        "x-paidmcp-trial-remaining",
        String(config.FREE_TRIAL_CALLS - getTrialCallsUsedByPayer(trialKey)),
      );
      return true;
    }
  } else {
    if (inFlightPayments.has(paymentHeader)) {
      res
        .status(409)
        .json(
          rpcError(-32000, "This payment is already in use by another request"),
        );
      return false;
    }
    inFlightPayments.add(paymentHeader);
    res.on("close", () => inFlightPayments.delete(paymentHeader));
  }

  const proceed = await runPaymentMiddleware(req, res, tool);
  ctx.paid = proceed && Boolean(paymentHeader);
  return proceed;
}

/**
 * Runs the x402 middleware against the tool's virtual route. Resolves true
 * once the payment is verified (settlement happens after the response is
 * written, and only if its status is below 400), or false if the middleware
 * answered the request itself, e.g. with 402 Payment Required.
 */
function runPaymentMiddleware(
  req: Request,
  res: Response,
  tool: PaidTool,
): Promise<boolean> {
  const originalUrl = req.url;
  req.url = `/tools/${tool.name}`;
  return new Promise<boolean>((resolve, reject) => {
    let nextCalled = false;
    const result = toolPaymentMiddleware(req, res, (err?: unknown) => {
      nextCalled = true;
      req.url = originalUrl;
      if (err) reject(err);
      else resolve(true);
    });
    Promise.resolve(result).then(
      () => {
        req.url = originalUrl;
        if (!nextCalled) resolve(false);
      },
      (err: unknown) => {
        req.url = originalUrl;
        reject(err);
      },
    );
  });
}

async function createSession(): Promise<StreamableHTTPServerTransport> {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sid) => {
      sessions.set(sid, { transport, server, lastSeen: Date.now() });
    },
  });
  transport.onclose = () => {
    if (transport.sessionId) closeSession(transport.sessionId);
  };
  await server.connect(transport);
  return transport;
}

function closeSession(sid: string): void {
  const session = sessions.get(sid);
  if (!session) return;
  sessions.delete(sid);
  void session.server.close().catch(() => undefined);
}

function closeIdleSessions(): void {
  const cutoff = Date.now() - config.SESSION_IDLE_MINUTES * 60_000;
  for (const [sid, session] of sessions) {
    if (session.lastSeen < cutoff) closeSession(sid);
  }
}

function rpcError(code: number, message: string) {
  return { jsonrpc: "2.0", error: { code, message }, id: null };
}

function createMcpServer(): Server {
  const mcp = new Server(
    { name: "paidmcp-template", version: "0.3.0" },
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

  mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = toolByName.get(request.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [
          { type: "text", text: `Unknown tool: ${request.params.name}` },
        ],
      };
    }

    const ctx = callContext.getStore();
    try {
      const input = tool.inputSchema.parse(request.params.arguments ?? {});
      const result = await tool.handler(input);
      return {
        structuredContent: result as Record<string, unknown>,
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (ctx?.trialCallId != null) {
        refundTrialCall(ctx.trialCallId, message);
      }
      if (ctx?.paid) {
        // A status of 400+ makes the x402 middleware cancel settlement, so
        // the caller is not charged for a failed call. The client still
        // receives the tool error below.
        ctx.res.statusCode = 502;
        logCall({ toolName: tool.name, success: false, errorMessage: message });
      }
      return { isError: true, content: [{ type: "text", text: message }] };
    }
  });

  return mcp;
}

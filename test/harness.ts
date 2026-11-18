import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { generateMnemonic } from "bip39";

const root = resolve(import.meta.dirname, "..");

/**
 * Minimal x402 facilitator: advertises Base Sepolia "exact", accepts every
 * payment on /verify, and counts /settle calls. Nothing touches a chain.
 */
export class FakeFacilitator {
  settleCalls = 0;
  private server: Server;
  url = "";

  constructor() {
    this.server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        const payer = "0x1111111111111111111111111111111111111111";
        if (req.url?.startsWith("/supported")) {
          res.end(
            JSON.stringify({
              kinds: [
                { x402Version: 2, scheme: "exact", network: "eip155:84532" },
              ],
              extensions: [],
              signers: {},
            }),
          );
        } else if (req.url?.startsWith("/verify")) {
          res.end(JSON.stringify({ isValid: true, payer }));
        } else if (req.url?.startsWith("/settle")) {
          this.settleCalls += 1;
          res.end(
            JSON.stringify({
              success: true,
              transaction: `0x${"ab".repeat(32)}`,
              network: "eip155:84532",
              payer,
            }),
          );
        } else {
          res.statusCode = 404;
          res.end("{}");
        }
      });
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}

/** Runs src/server.ts with the test tools from test/fixtures/tools.ts. */
export class TestServer {
  url = "";
  private child?: ChildProcess;
  private dir = "";

  constructor(
    private facilitatorUrl: string,
    private env: Record<string, string> = {},
  ) {}

  async start(): Promise<void> {
    mkdirSync(join(root, "test", ".tmp"), { recursive: true });
    this.dir = mkdtempSync(join(root, "test", ".tmp", "run-"));
    cpSync(join(root, "src"), join(this.dir, "src"), { recursive: true });
    cpSync(
      join(root, "test", "fixtures", "tools.ts"),
      join(this.dir, "src", "tools.ts"),
    );
    const port = 20000 + Math.floor(Math.random() * 20000);
    this.child = spawn(
      process.execPath,
      ["--import", "tsx", join(this.dir, "src", "server.ts")],
      {
        cwd: this.dir,
        env: {
          PATH: process.env.PATH ?? "",
          SEED_PHRASE: generateMnemonic(128),
          NETWORK_MODE: "test",
          BASE_FACILITATOR_URL: this.facilitatorUrl,
          FREE_TRIAL_CALLS: "0",
          PORT: String(port),
          DB_PATH: join(this.dir, "test.db"),
          ...this.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    this.child.stdout?.on("data", (d) => (output += d));
    this.child.stderr?.on("data", (d) => (output += d));
    this.url = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (this.child.exitCode !== null) {
        throw new Error(`server exited early:\n${output}`);
      }
      try {
        if ((await fetch(`${this.url}/health`)).ok) return;
      } catch {
        // not listening yet
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`server did not start:\n${output}`);
  }

  async stop(): Promise<void> {
    this.child?.kill();
    rmSync(this.dir, { recursive: true, force: true });
  }
}

export type RpcResponse = {
  status: number;
  headers: Headers;
  body: any;
  text: string;
};

/** Minimal MCP-over-HTTP client for the tests. */
export class McpClient {
  sessionId = "";
  private nextId = 1;

  constructor(private url: string) {}

  async post(
    body: unknown,
    headers: Record<string, string> = {},
    contentType = "application/json",
  ): Promise<RpcResponse> {
    const res = await fetch(`${this.url}/mcp`, {
      method: "POST",
      headers: {
        "content-type": contentType,
        accept: "application/json, text/event-stream",
        ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return {
      status: res.status,
      headers: res.headers,
      body: parse(text),
      text,
    };
  }

  async initialize(): Promise<void> {
    const res = await this.post({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
    });
    this.sessionId = res.headers.get("mcp-session-id") ?? "";
    if (!this.sessionId) throw new Error(`initialize failed: ${res.text}`);
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  callMessage(name: string, args: Record<string, unknown>) {
    return {
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "tools/call",
      params: { name, arguments: args },
    };
  }

  callTool(
    name: string,
    args: Record<string, unknown>,
    headers: Record<string, string> = {},
  ): Promise<RpcResponse> {
    return this.post(this.callMessage(name, args), headers);
  }
}

/** Builds a PAYMENT-SIGNATURE header for the first requirement of a 402. */
export function fakePayment(paymentRequired: string, nonce = "01"): string {
  const required = JSON.parse(
    Buffer.from(paymentRequired, "base64").toString("utf8"),
  );
  const accepted = required.accepts[0];
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    x402Version: 2,
    resource: required.resource,
    accepted,
    payload: {
      signature: `0x${"11".repeat(65)}`,
      authorization: {
        from: "0x1111111111111111111111111111111111111111",
        to: accepted.payTo,
        value: accepted.amount,
        validAfter: String(now - 60),
        validBefore: String(now + 600),
        nonce: `0x${nonce.padStart(64, "0")}`,
      },
    },
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

function parse(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }
  for (const line of trimmed.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      const data = line.slice(5).trim();
      if (data.startsWith("{")) return JSON.parse(data);
    }
  }
  return null;
}

/** True when a tools/call response carries a successful tool result. */
export function toolRan(res: RpcResponse): boolean {
  return Boolean(res.body?.result && !res.body.result.isError);
}

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
  FakeFacilitator,
  McpClient,
  TestServer,
  fakePayment,
  toolRan,
} from "./harness.js";

const facilitator = new FakeFacilitator();
before(() => facilitator.start());
after(() => facilitator.stop());

describe("payment is required (no free trial)", () => {
  let server: TestServer;
  let client: McpClient;

  before(async () => {
    server = new TestServer(facilitator.url, { FREE_TRIAL_CALLS: "0" });
    await server.start();
    client = new McpClient(server.url);
    await client.initialize();
  });
  after(() => server.stop());

  test("an unpaid call gets 402 and the tool does not run", async () => {
    const res = await client.callTool("echo", { message: "hi" });
    assert.equal(res.status, 402);
    assert.ok(res.headers.get("payment-required"));
    assert.equal(toolRan(res), false);
  });

  test("a batch request is rejected instead of skipping payment", async () => {
    const res = await client.post([
      client.callMessage("echo", { message: "batch" }),
    ]);
    assert.equal(res.status, 400);
    assert.doesNotMatch(res.text, /"echoed"/);
  });

  test("a non-JSON content type is rejected instead of skipping payment", async () => {
    const res = await client.post(
      client.callMessage("echo", { message: "ct" }),
      {},
      "text/plain; x=application/json",
    );
    assert.equal(res.status, 415);
    assert.doesNotMatch(res.text, /"echoed"/);
  });

  test("an unknown session gets 404", async () => {
    const res = await client.callTool(
      "echo",
      { message: "hi" },
      { "mcp-session-id": "not-a-session" },
    );
    assert.equal(res.status, 404);
  });

  test("a paid call runs the tool and settles once", async () => {
    const unpaid = await client.callTool("echo", { message: "paid" });
    const before = facilitator.settleCalls;
    const res = await client.callTool(
      "echo",
      { message: "paid" },
      {
        "payment-signature": fakePayment(
          unpaid.headers.get("payment-required")!,
          "a1",
        ),
      },
    );
    assert.equal(res.status, 200);
    assert.equal(toolRan(res), true);
    assert.equal(facilitator.settleCalls, before + 1);
  });

  test("a paid call whose tool fails is not settled", async () => {
    const unpaid = await client.callTool("fail", {});
    assert.equal(unpaid.status, 402);
    const before = facilitator.settleCalls;
    const res = await client.callTool(
      "fail",
      {},
      {
        "payment-signature": fakePayment(
          unpaid.headers.get("payment-required")!,
          "a2",
        ),
      },
    );
    assert.equal(res.body?.result?.isError, true);
    assert.match(res.text, /upstream unavailable/);
    assert.equal(facilitator.settleCalls, before);
  });

  test("one payment cannot run two calls at the same time", async () => {
    const unpaid = await client.callTool("slow", { message: "x" });
    const payment = fakePayment(unpaid.headers.get("payment-required")!, "a3");
    const [first, second] = await Promise.all([
      client.callTool(
        "slow",
        { message: "x" },
        { "payment-signature": payment },
      ),
      client.callTool(
        "slow",
        { message: "x" },
        { "payment-signature": payment },
      ),
    ]);
    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, [200, 409]);
  });
});

describe("free trial", () => {
  let server: TestServer;
  let client: McpClient;

  before(async () => {
    server = new TestServer(facilitator.url, { FREE_TRIAL_CALLS: "2" });
    await server.start();
    client = new McpClient(server.url);
    await client.initialize();
  });
  after(() => server.stop());

  test("invalid input and failed tools do not use up trial calls", async () => {
    const invalid = await client.callTool("echo", { message: 42 });
    assert.equal(invalid.body?.result?.isError, true);
    const failed = await client.callTool("fail", {});
    assert.equal(failed.body?.result?.isError, true);
  });

  test("the trial allows exactly FREE_TRIAL_CALLS calls", async () => {
    const first = await client.callTool("echo", { message: "1" });
    assert.equal(toolRan(first), true);
    assert.equal(first.headers.get("x-paidmcp-trial-remaining"), "1");
    const second = await client.callTool("echo", { message: "2" });
    assert.equal(toolRan(second), true);
    assert.equal(second.headers.get("x-paidmcp-trial-remaining"), "0");
    const third = await client.callTool("echo", { message: "3" });
    assert.equal(third.status, 402);
  });

  test("client-chosen identity headers do not reset the trial", async () => {
    for (const header of ["x402-payer", "x-payment-payer", "x-paidmcp-trial"]) {
      const res = await client.callTool(
        "echo",
        { message: "spoof" },
        { [header]: `spoofed-${Math.random()}` },
      );
      assert.equal(res.status, 402, `${header} reset the trial`);
    }
  });

  test("X-Forwarded-For is ignored unless TRUST_PROXY is set", async () => {
    const res = await client.callTool(
      "echo",
      { message: "xff" },
      { "x-forwarded-for": "203.0.113.7" },
    );
    assert.equal(res.status, 402);
  });
});

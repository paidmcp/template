# paidmcp/template

Build native Streamable HTTP MCP servers that charge per call with x402.

## Quickstart

Requires Node.js 22 or newer.

```bash
npm install
npm run setup
npm run dev
```

Default setup is `NETWORK_MODE=test` so you can start with Base Sepolia before switching to live mode.

## Commands

| Command                      | What it does                                                    |
| ---------------------------- | --------------------------------------------------------------- |
| `npm run setup`              | creates `.env`, generates `SEED_PHRASE` (never overwrites one)  |
| `npm run wallet:create`      | prints a new receiver seed phrase                               |
| `npm run wallet:info`        | shows receiver address plus Base/Plasma balances                |
| `npm run calls:recent`       | shows recent paid/trial calls from SQLite                       |
| `npm run dev`                | starts the native MCP server at `/mcp`                          |
| `npm run build && npm start` | runs compiled server                                            |
| `npm test`                   | runs the payment-enforcement tests (no chain or network needed) |
| `npm run check`              | lint, typecheck, build and test                                 |

## Endpoints

- Native MCP endpoint: `POST/GET/DELETE /mcp`
- Compatibility listing endpoint: `GET /mcp/tools`
- Health check: `GET /health`

Tool authoring stays in `src/tools.ts`. The server automatically exposes those tools over MCP and enforces x402 for `tools/call`.

## Payment behavior

- Every `tools/call` for a listed tool needs an x402 payment, unless the caller still has free trial calls.
- Each POST must be a single JSON-RPC message with `Content-Type: application/json`. Batch requests are rejected.
- Calls with unknown tools or invalid arguments are rejected before any tool code runs, and are never charged.
- If a paid tool fails, the payment is not settled, so the caller is not charged.
- A payment signature can only be used by one request at a time.

## Free trial

- `FREE_TRIAL_CALLS` sets the free calls per client IP: 10 by default in test mode, 0 in live mode.
- Trial calls are reserved before the tool runs, so concurrent requests cannot exceed the quota. A failed trial call is given back.
- Behind a proxy (Fly.io, Railway), set `TRUST_PROXY=1` so the real client IP is used. `deploy/fly.toml` already does this.
- IP limits can be bypassed by clients with many addresses. Keep live-mode trials low for expensive tools.

## Key files

- `src/tools.ts` - define paid tools (`name`, `description`, `priceUsdt`, schema, handler)
- `src/server.ts` - MCP transport + per-tool x402 enforcement + trial handling
- `src/config.ts` - env validation
- `src/log.ts` - SQLite call logging
- `src/payments.ts` - facilitator + x402 scheme wiring

## Environment

See `.env.example` for all variables.

- `NETWORK_MODE=test|live` picks the defaults: Base Sepolia USDC with the x402.org facilitator in test mode; Base mainnet USDC with the Coinbase CDP facilitator, plus Plasma USDT0, in live mode.
- Leave `BASE_RPC_URL`, `USDC_ADDRESS` and `BASE_FACILITATOR_URL` empty to use those defaults.
- For the live Coinbase facilitator, set `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET`.

## Deployment

- Fly.io config: `deploy/fly.toml`
- Railway config: `deploy/railway.json`
- Dockerfile: `deploy/Dockerfile`

`deploy/fly.toml` sets `DB_PATH=/app/data/paidmcp.db` so SQLite persists on the mounted volume, and `TRUST_PROXY=1`. On Railway, set `TRUST_PROXY=1` in the service variables.

## License

MIT. See `LICENSE`.

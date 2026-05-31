# paidmcp/template

Build native Streamable HTTP MCP servers that charge per call with x402.

## Quickstart

Run inside `template/`:

```bash
npm install
npm run setup
npm run dev
```

Default setup is `NETWORK_MODE=test` so you can start with Base Sepolia before switching to live mode.

## Commands

Run inside `template/` after `npm install`.

| Command                      | What it does                                                     |
| ---------------------------- | ---------------------------------------------------------------- |
| `npm run setup`              | creates `.env` defaults, generates `SEED_PHRASE`, sets test mode |
| `npm run wallet:create`      | prints a new receiver seed phrase                                |
| `npm run wallet:info`        | shows receiver address plus Base/Plasma balances                 |
| `npm run calls:recent`       | shows recent paid/trial calls from SQLite                        |
| `npm run dev`                | starts the native MCP server at `/mcp`                           |
| `npm run build && npm start` | runs compiled server                                             |

## Endpoints

- Native MCP endpoint: `POST/GET/DELETE /mcp`
- Compatibility listing endpoint: `GET /mcp/tools`

Tool authoring stays in `src/tools.ts`. The server automatically exposes those tools over MCP and enforces x402 for `tools/call`.

## Free trial + payment behavior

- `FREE_TRIAL_CALLS` controls how many successful trial calls each payer gets.
- After trial quota, tool calls require x402 settlement.
- Successful paid calls and successful trial calls are both logged in SQLite (`is_trial` column).

## Key files

- `src/tools.ts` - define paid tools (`name`, `description`, `priceUsdt`, schema, handler)
- `src/server.ts` - MCP transport + per-tool x402 enforcement + trial handling
- `src/config.ts` - env validation
- `src/log.ts` - SQLite call logging
- `src/payments.ts` - facilitator + x402 scheme wiring

## Environment

See `.env.example` for all variables.

- `NETWORK_MODE=test|live` controls default network/facilitator behavior.
- Leave `BASE_FACILITATOR_URL` empty to use mode defaults.
- For live Coinbase facilitator, set `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET`.

## Deployment

- Fly.io config: `deploy/fly.toml`
- Railway config: `deploy/railway.json`
- Dockerfile: `deploy/Dockerfile`

`deploy/fly.toml` sets `DB_PATH=/app/data/paidmcp.db` so SQLite persists on the mounted volume.

## License

MIT. See `LICENSE`.

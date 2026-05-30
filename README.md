# paidmcp/template

Build MCP servers that charge per call in USDC (Base) or USDT0 (Plasma), powered by x402 + Tether WDK.

## Quickstart

Run inside `template/`:

```bash
npm install
cp .env.example .env
npm run wallet:create
# paste seed into .env as SEED_PHRASE
npm run dev
```

## Commands

Run inside `template/` after `npm install`.

| Command | Role | What it does |
|---------|------|--------------|
| `npm run wallet:create` | Server receiver | Prints a new seed phrase. Paste it into `.env` as `SEED_PHRASE`. |
| `npm run wallet:info` | Server receiver | Shows receiver address plus Base USDC and Plasma USDT0 balances. |
| `npm run calls:recent` | Server operator | Shows the last paid calls from SQLite. |
| `npm run dev` | Server operator | Starts the local server and creates the SQLite DB automatically. |
| `npm run build && npm start` | Server operator | Runs compiled server code. |

## Two wallets to keep separate

- **Receiver wallet (server):** created by `npm run wallet:create` and stored in this project's `.env` as `SEED_PHRASE`.
- **Payer wallet (client):** created in `client/` with `npm run init`, stored in `~/.paidmcp/config.json`.

Fund the payer wallet for test calls. The server receiver wallet should not be funded manually for normal flow.

## Unpaid test

```bash
curl -X POST http://localhost:4021/tools/echo \
  -H "Content-Type: application/json" \
  -d '{"message":"hello"}'
```

Expected result: HTTP `402` with x402 payment requirements.

## Key files

- `src/tools.ts` - add or modify paid tools (primary customization file)
- `src/server.ts` - MCP + x402 + HTTP routes wiring
- `src/config.ts` - env validation
- `src/wallet.ts` - wallet wrapper
- `src/log.ts` - SQLite call logging

## Environment

See `.env.example` for all variables.

### Facilitator setup

- **Base (USDC):** `BASE_FACILITATOR_URL` (default in `.env.example` is Coinbase CDP).
- **Plasma (USDT0):** `PLASMA_FACILITATOR_URL` (default is Semantic).
- To disable a network, set that URL to an empty string (`""`).
- If using Coinbase CDP on Base, set `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET`.

## Deployment

- Fly.io config: `deploy/fly.toml`
- Railway config: `deploy/railway.json`
- Dockerfile: `deploy/Dockerfile`

## License

MIT

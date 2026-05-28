# paidmcp/template

Build MCP servers that charge per-call in USDT, powered by x402 + Tether WDK.

## Quickstart

```bash
npm install
cp .env.example .env
npm run wallet:create
# paste seed into .env as SEED_PHRASE
npm run dev
```

Test an unpaid call:

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

## Deployment

- Fly.io config: `deploy/fly.toml`
- Railway config: `deploy/railway.json`
- Dockerfile: `deploy/Dockerfile`

## License

MIT

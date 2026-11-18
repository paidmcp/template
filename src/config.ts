import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ quiet: true });

const evmAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "must be a 0x EVM address");
const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());
const optionalString = z.preprocess(
  emptyToUndefined,
  z.string().min(1).optional(),
);
const optionalInt = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().nonnegative().optional(),
);
const networkMode = z.enum(["test", "live"]).default("test");

const ConfigSchema = z.object({
  SEED_PHRASE: z.string().min(20, "SEED_PHRASE must be a real mnemonic"),
  NETWORK_MODE: networkMode,
  BASE_RPC_URL: optionalUrl,
  PLASMA_RPC_URL: z.string().url().default("https://rpc.plasma.to"),
  USDC_ADDRESS: z.preprocess(emptyToUndefined, evmAddress.optional()),
  USDT0_ADDRESS: evmAddress.default(
    "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb",
  ),
  BASE_FACILITATOR_URL: optionalUrl,
  // "off" disables Base payments; empty uses the mode default.
  BASE_PAYMENTS: z.enum(["on", "off"]).default("on"),
  PLASMA_FACILITATOR_URL: optionalUrl,
  CDP_API_KEY_ID: optionalString,
  CDP_API_KEY_SECRET: optionalString,
  // Unset: 10 in test mode, 0 in live mode.
  FREE_TRIAL_CALLS: optionalInt,
  // Number of reverse proxies in front of the server (1 on Fly.io/Railway).
  // Leave 0 when clients connect directly, or X-Forwarded-For can be spoofed.
  TRUST_PROXY: z.coerce.number().int().nonnegative().default(0),
  MAX_SESSIONS: z.coerce.number().int().positive().default(1000),
  SESSION_IDLE_MINUTES: z.coerce.number().positive().default(30),
  PORT: z.coerce.number().default(4021),
  ANTHROPIC_API_KEY: z.string().optional(),
  DB_PATH: z.string().default("./paidmcp.db"),
});

const parsed = ConfigSchema.parse(process.env);
const isTest = parsed.NETWORK_MODE === "test";

const BASE_DEFAULTS = isTest
  ? {
      rpcUrl: "https://sepolia.base.org",
      usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      // EIP-712 domain of the USDC contract; must match the token exactly.
      usdcName: "USDC",
      facilitatorUrl: "https://x402.org/facilitator",
    }
  : {
      rpcUrl: "https://mainnet.base.org",
      usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      usdcName: "USD Coin",
      facilitatorUrl: "https://api.cdp.coinbase.com/platform/v2/x402",
    };

export const config = {
  ...parsed,
  BASE_RPC_URL: parsed.BASE_RPC_URL ?? BASE_DEFAULTS.rpcUrl,
  USDC_ADDRESS: parsed.USDC_ADDRESS ?? BASE_DEFAULTS.usdcAddress,
  USDC_EIP712_NAME: BASE_DEFAULTS.usdcName,
  BASE_FACILITATOR_URL:
    parsed.BASE_PAYMENTS === "off"
      ? undefined
      : (parsed.BASE_FACILITATOR_URL ?? BASE_DEFAULTS.facilitatorUrl),
  // Plasma has no testnet here: it is only enabled by default in live mode.
  PLASMA_FACILITATOR_URL:
    parsed.PLASMA_FACILITATOR_URL ??
    (isTest ? undefined : "https://x402.semanticpay.io/"),
  FREE_TRIAL_CALLS: parsed.FREE_TRIAL_CALLS ?? (isTest ? 10 : 0),
};

if (
  parsed.USDC_ADDRESS &&
  parsed.USDC_ADDRESS.toLowerCase() !== BASE_DEFAULTS.usdcAddress.toLowerCase()
) {
  console.warn(
    `[config] USDC_ADDRESS is not the ${isTest ? "Base Sepolia" : "Base mainnet"} USDC contract; check NETWORK_MODE.`,
  );
}
if (isTest && config.PLASMA_FACILITATOR_URL) {
  console.warn(
    "[config] Plasma payments use mainnet USDT0 (real money) even in test mode.",
  );
}

export const BASE_NETWORK: "eip155:84532" | "eip155:8453" = isTest
  ? "eip155:84532"
  : "eip155:8453";
export const PLASMA_NETWORK = "eip155:9745" as const;

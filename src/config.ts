import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const evmAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "must be a 0x EVM address");
const optionalUrl = z.preprocess((v) => (v === "" ? undefined : v), z.string().url().optional());
const optionalString = z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional());

const ConfigSchema = z.object({
  SEED_PHRASE: z.string().min(20, "SEED_PHRASE must be a real mnemonic"),
  BASE_RPC_URL: z.string().url(),
  PLASMA_RPC_URL: z.string().url(),
  USDC_ADDRESS: evmAddress,
  USDT0_ADDRESS: evmAddress,
  BASE_FACILITATOR_URL: optionalUrl,
  PLASMA_FACILITATOR_URL: optionalUrl,
  CDP_API_KEY_ID: optionalString,
  CDP_API_KEY_SECRET: optionalString,
  PORT: z.coerce.number().default(4021),
  ANTHROPIC_API_KEY: z.string().optional(),
  DB_PATH: z.string().default("./paidmcp.db")
});

export const config = ConfigSchema.parse(process.env);

export const BASE_NETWORK = "eip155:8453" as const;
export const PLASMA_NETWORK = "eip155:9745" as const;

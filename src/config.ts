import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const ConfigSchema = z.object({
  SEED_PHRASE: z.string().min(20, "SEED_PHRASE must be a real mnemonic"),
  NETWORK_ID: z.string().regex(/^eip155:\d+$/, "NETWORK_ID must use CAIP-2 format"),
  USDT0_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  RPC_URL: z.string().url(),
  FACILITATOR_URL: z.string().url(),
  PORT: z.coerce.number().default(4021),
  ANTHROPIC_API_KEY: z.string().optional(),
  DB_PATH: z.string().default("./paidmcp.db")
});

export const config = ConfigSchema.parse(process.env);

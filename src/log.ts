import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";

mkdirSync(dirname(config.DB_PATH), { recursive: true });
const db = new Database(config.DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_name TEXT NOT NULL,
    payer_address TEXT,
    amount_usdt REAL,
    tx_hash TEXT,
    timestamp INTEGER NOT NULL,
    success INTEGER NOT NULL,
    error_message TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_tool_name ON calls(tool_name);
  CREATE INDEX IF NOT EXISTS idx_timestamp ON calls(timestamp);
`);

export interface CallLogEntry {
  toolName: string;
  payerAddress?: string;
  amountUsdt?: number;
  txHash?: string;
  success: boolean;
  errorMessage?: string;
}

const insertCall = db.prepare(`
  INSERT INTO calls (tool_name, payer_address, amount_usdt, tx_hash, timestamp, success, error_message)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

export function logCall(entry: CallLogEntry): void {
  insertCall.run(
    entry.toolName,
    entry.payerAddress ?? null,
    entry.amountUsdt ?? null,
    entry.txHash ?? null,
    Date.now(),
    entry.success ? 1 : 0,
    entry.errorMessage ?? null
  );
}

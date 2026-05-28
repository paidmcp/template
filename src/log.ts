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

export function getStats(): {
  totalCalls: number;
  totalVolume: number;
  byTool: Record<string, { count: number; volume: number }>;
} {
  const total = db
    .prepare("SELECT COUNT(*) as count, COALESCE(SUM(amount_usdt), 0) as volume FROM calls WHERE success = 1")
    .get() as { count: number; volume: number };
  const rows = db
    .prepare(
      "SELECT tool_name, COUNT(*) as count, COALESCE(SUM(amount_usdt), 0) as volume FROM calls WHERE success = 1 GROUP BY tool_name"
    )
    .all() as Array<{ tool_name: string; count: number; volume: number }>;

  const byTool = Object.fromEntries(rows.map((row) => [row.tool_name, { count: row.count, volume: row.volume }]));
  return { totalCalls: total.count, totalVolume: total.volume, byTool };
}

export function getRecentCalls(limit: number): CallLogEntry[] {
  const rows = db
    .prepare(
      "SELECT tool_name, payer_address, amount_usdt, tx_hash, success, error_message FROM calls ORDER BY timestamp DESC LIMIT ?"
    )
    .all(limit) as Array<{
      tool_name: string;
      payer_address: string | null;
      amount_usdt: number | null;
      tx_hash: string | null;
      success: number;
      error_message: string | null;
    }>;

  return rows.map((row) => ({
    toolName: row.tool_name,
    payerAddress: row.payer_address ?? undefined,
    amountUsdt: row.amount_usdt ?? undefined,
    txHash: row.tx_hash ?? undefined,
    success: row.success === 1,
    errorMessage: row.error_message ?? undefined
  }));
}

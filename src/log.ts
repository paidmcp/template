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
    error_message TEXT,
    is_trial INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_tool_name ON calls(tool_name);
  CREATE INDEX IF NOT EXISTS idx_timestamp ON calls(timestamp);
`);

function ensureColumn(name: string, definition: string): void {
  const columns = db
    .prepare("SELECT name FROM pragma_table_info('calls') WHERE name = ?")
    .all(name) as Array<{ name: string }>;
  if (columns.length === 0) {
    db.exec(`ALTER TABLE calls ADD COLUMN ${name} ${definition}`);
  }
}

ensureColumn("is_trial", "INTEGER NOT NULL DEFAULT 0");
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_payer_success_trial ON calls(payer_address, success, is_trial)",
);

export interface CallLogEntry {
  toolName: string;
  payerAddress?: string;
  amountUsdt?: number;
  txHash?: string;
  success: boolean;
  errorMessage?: string;
  isTrial?: boolean;
}

const insertCall = db.prepare(`
  INSERT INTO calls (tool_name, payer_address, amount_usdt, tx_hash, timestamp, success, error_message, is_trial)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const countTrialCallsByPayer = db.prepare(`
  SELECT COUNT(*) as count
  FROM calls
  WHERE payer_address = ? AND success = 1 AND is_trial = 1
`);

export function logCall(entry: CallLogEntry): void {
  insertCall.run(
    entry.toolName,
    entry.payerAddress ?? null,
    entry.amountUsdt ?? null,
    entry.txHash ?? null,
    Date.now(),
    entry.success ? 1 : 0,
    entry.errorMessage ?? null,
    entry.isTrial ? 1 : 0,
  );
}

export function getTrialCallsUsedByPayer(payerAddress: string): number {
  const row = countTrialCallsByPayer.get(payerAddress) as { count: number };
  return row.count ?? 0;
}

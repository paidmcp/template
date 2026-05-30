import Database from "better-sqlite3";
import { config } from "../config.js";

const db = new Database(config.DB_PATH, { readonly: true });
const rows = db
  .prepare(
    `SELECT id, tool_name, payer_address, amount_usdt, tx_hash,
            datetime(timestamp / 1000, 'unixepoch') AS at, success, error_message
     FROM calls
     ORDER BY id DESC
     LIMIT 20`
  )
  .all();

if (rows.length === 0) {
  console.log("No calls logged yet.");
  process.exit(0);
}

console.table(rows);

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateMnemonic } from "bip39";

const envPath = resolve(process.cwd(), ".env");
const templatePath = resolve(process.cwd(), ".env.example");
const force = process.argv.includes("--force");

if (!existsSync(templatePath)) {
  throw new Error("Missing .env.example");
}

const base = readFileSync(templatePath, "utf8");
const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : base;

const existingSeed = readValue(current, "SEED_PHRASE");
if (existingSeed && !force) {
  console.error(`${envPath} already has a SEED_PHRASE. Nothing was changed.`);
  console.error(
    "Replacing it makes any funds received by that wallet inaccessible unless you have backed up the phrase.",
  );
  console.error("To replace it anyway: npm run setup -- --force");
  process.exit(1);
}

let next = upsert(current, "SEED_PHRASE", generateMnemonic(128));
if (!readValue(next, "NETWORK_MODE")) {
  next = upsert(next, "NETWORK_MODE", "test");
}
writeFileSync(envPath, next, { mode: 0o600 });

console.log(`Wrote ${envPath} with a new SEED_PHRASE.`);
console.log(
  "Back up the seed phrase: anyone with it controls the receiver wallet.",
);
console.log(`NETWORK_MODE=${readValue(next, "NETWORK_MODE")}`);
console.log("Next steps:");
console.log("  npm run wallet:info");
console.log("  npm run dev");

function readValue(text: string, key: string): string | undefined {
  const match = new RegExp(`^${key}=(.*)$`, "m").exec(text);
  const value = match?.[1]?.trim().replace(/^"(.*)"$/, "$1");
  return value ? value : undefined;
}

function upsert(text: string, key: string, value: string): string {
  const line = `${key}="${value}"`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(text)) {
    return text.replace(pattern, line);
  }
  return `${text.trimEnd()}\n${line}\n`;
}

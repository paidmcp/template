import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateMnemonic } from "bip39";

const envPath = resolve(process.cwd(), ".env");
const templatePath = resolve(process.cwd(), ".env.example");

if (!existsSync(templatePath)) {
  throw new Error("Missing .env.example");
}

const seed = generateMnemonic(128);
const base = readFileSync(templatePath, "utf8");
const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : base;

const next = upsert(
  upsert(current, "SEED_PHRASE", seed),
  "NETWORK_MODE",
  "test",
);
writeFileSync(envPath, next, { mode: 0o600 });

console.log(`Wrote ${envPath}`);
console.log("NETWORK_MODE=test and SEED_PHRASE generated.");
console.log("Next steps:");
console.log("  npm run wallet:info");
console.log("  npm run dev");

function upsert(text: string, key: string, value: string): string {
  const line = `${key}="${value}"`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(text)) {
    return text.replace(pattern, line);
  }
  return `${text.trimEnd()}\n${line}\n`;
}

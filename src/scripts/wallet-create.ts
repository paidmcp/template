import { generateMnemonic } from "bip39";

console.log("\nGenerated seed phrase (copy into .env as SEED_PHRASE):\n");
console.log(generateMnemonic(128));
console.log("\nKeep this seed secret. It grants full wallet control.\n");

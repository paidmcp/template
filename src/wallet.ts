import WalletManagerEvm from "@tetherto/wdk-wallet-evm";
import { config } from "./config.js";

let cachedAccount: Awaited<ReturnType<WalletManagerEvm["getAccount"]>> | null =
  null;

async function getAccount() {
  if (!cachedAccount) {
    const manager = new WalletManagerEvm(config.SEED_PHRASE, {
      provider: config.BASE_RPC_URL,
    });
    cachedAccount = await manager.getAccount();
  }
  return cachedAccount;
}

export async function getReceiverAddress(): Promise<string> {
  const account = await getAccount();
  return account.getAddress();
}

import WalletManagerEvm from "@tetherto/wdk-wallet-evm";
import { config } from "../config.js";
import { getReceiverAddress } from "../wallet.js";

function formatUnits(value: bigint, decimals = 6): string {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = (value % base)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

const address = await getReceiverAddress();
console.log("Receiver address:", address);

const baseAccount = await new WalletManagerEvm(config.SEED_PHRASE, {
  provider: config.BASE_RPC_URL,
}).getAccount();
const plasmaAccount = await new WalletManagerEvm(config.SEED_PHRASE, {
  provider: config.PLASMA_RPC_URL,
}).getAccount();

const [usdc, usdt0] = await Promise.all([
  baseAccount.getTokenBalance(config.USDC_ADDRESS).catch(() => null),
  plasmaAccount.getTokenBalance(config.USDT0_ADDRESS).catch(() => null),
]);

console.log(
  `Base   USDC:  ${usdc === null ? "(unavailable)" : formatUnits(usdc)}`,
);
console.log(
  `Plasma USDT0: ${usdt0 === null ? "(unavailable)" : formatUnits(usdt0)}`,
);

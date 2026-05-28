import { getReceiverAddress } from "../wallet.js";

const receiver = await getReceiverAddress();
console.log("Receiver address:", receiver);
console.log("Fund this address with USDT0 on Plasma to receive tool-call payments.");

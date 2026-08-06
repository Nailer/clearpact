import { createPublicClient, http, defineChain } from "viem";
import { ARC_TESTNET } from "./config";

export const arcTestnetChain = defineChain({
  id: ARC_TESTNET.id,
  name: ARC_TESTNET.name,
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_TESTNET.rpcUrl] } },
  blockExplorers: { default: { name: "ArcScan", url: ARC_TESTNET.explorer } },
  contracts: {
    // Confirmed deployed on Arc testnet at the standard address — viem
    // doesn't auto-detect Multicall3, it must be declared per chain.
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
});

export const publicClient = createPublicClient({
  chain: arcTestnetChain,
  transport: http(ARC_TESTNET.rpcUrl),
});

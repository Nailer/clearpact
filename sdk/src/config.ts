import { defineChain } from "viem";

/** Arc testnet — USDC is the native gas token, 18 decimals. */
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  blockExplorers: { default: { name: "ArcScan", url: "https://testnet.arcscan.app" } },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
});

/** ClearPact protocol's live Arc testnet deployment. Override for other
 *  environments (e.g. Arc mainnet once available) by passing `addresses`
 *  to `createClearPactClient`. */
export const DEFAULT_ADDRESSES = {
  escrow: "0xDbd9976d55987c956DBfEcad1b98A3Cf00e58b28" as `0x${string}`,
  milestoneEscrow: "0x783A0230b5912520B06e49a98BB578975A370391" as `0x${string}`,
  registry: "0x3c639b6C061F4C14dbac60E0C48010Ef7888B1Ec" as `0x${string}`,
};

export const ARC_TESTNET = {
  id: 5042002,
  name: "Arc Testnet",
  // The primary public RPC (rpc.testnet.arc.network) rate-limits aggressively
  // under sustained dev-tool usage; dRPC's Arc testnet endpoint held up
  // reliably in testing and is used as the default here. Override via env.
  rpcUrl: process.env.NEXT_PUBLIC_ARC_TESTNET_RPC ?? "https://rpc.drpc.testnet.arc.network",
  explorer: "https://testnet.arcscan.app",
} as const;

export const CONTRACTS = {
  escrow: (process.env.NEXT_PUBLIC_ESCROW_ADDRESS_V2 ??
    "0xDbd9976d55987c956DBfEcad1b98A3Cf00e58b28") as `0x${string}`,
  registry: (process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ??
    "0x3c639b6C061F4C14dbac60E0C48010Ef7888B1Ec") as `0x${string}`,
  milestoneEscrow: (process.env.NEXT_PUBLIC_MILESTONE_ESCROW_ADDRESS ??
    "0x783A0230b5912520B06e49a98BB578975A370391") as `0x${string}`,
} as const;

export function explorerAddress(address: string): string {
  return `${ARC_TESTNET.explorer}/address/${address}`;
}

export function explorerTx(hash: string): string {
  return `${ARC_TESTNET.explorer}/tx/${hash}`;
}

export function shortAddr(address: string | undefined | null): string {
  if (!address) return "—";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Native USDC on Arc is 18 decimals, not the usual ERC-20 6. */
export function formatUsdc(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = wei % 10n ** 18n;
  const fracStr = frac.toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

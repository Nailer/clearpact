/**
 * Escrow a single-payment job, have it delivered and graded, and settle it —
 * the full lifecycle in a handful of calls. Run with a real private key on
 * Arc testnet:
 *
 *   BUYER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... VERIFIER_PRIVATE_KEY=0x... \
 *     npx tsx examples/basic-escrow.ts
 */
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createClearPactClient, arcTestnet } from "../src/index.js";

function walletFor(privateKey: string) {
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  return createWalletClient({ account, chain: arcTestnet, transport: http() });
}

async function main() {
  const buyerWallet = walletFor(process.env.BUYER_PRIVATE_KEY!);
  const workerWallet = walletFor(process.env.WORKER_PRIVATE_KEY!);
  const verifierWallet = walletFor(process.env.VERIFIER_PRIVATE_KEY!);

  const buyer = createClearPactClient({ walletClient: buyerWallet });
  const worker = createClearPactClient({ walletClient: workerWallet });
  const verifier = createClearPactClient({ walletClient: verifierWallet });

  // 1. Buyer escrows USDC for the job. One call — this is the "drop-in" part.
  const { jobId } = await buyer.escrowPayment({
    worker: workerWallet.account.address,
    verifier: verifierWallet.account.address,
    description: "Write a 3-sentence summary of the attached dataset.",
    amount: "0.5",
    passScore: 70,
    deadlineMinutes: 60,
    disputeWindowSeconds: 300,
  });
  console.log("job created:", jobId);

  // 2. Worker does the job and delivers.
  await worker.deliver({ jobId, deliverable: "The dataset contains..." });
  console.log("delivered");

  // 3. Verifier grades it. This is the sole settlement trigger.
  await verifier.submitVerdict({ jobId, score: 92, rationale: "Covers all required points." });
  console.log("graded 92/100");

  // 4. After the dispute window closes, anyone can settle — permissionless.
  //    (In production, wait for the real window; this example just shows the call.)
  const { txHash } = await buyer.settle({ jobId });
  console.log("settled:", txHash);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

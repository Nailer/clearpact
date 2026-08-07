/**
 * A 3-milestone streaming job — the worker gets paid for each verified chunk
 * independently, instead of waiting for the whole job to finish.
 *
 *   BUYER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... VERIFIER_PRIVATE_KEY=0x... \
 *     npx tsx examples/milestone-job.ts
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

  const { jobId } = await buyer.escrowMilestonePayment({
    worker: workerWallet.account.address,
    verifier: verifierWallet.account.address,
    description: "Three-part README: summary, features, install instructions.",
    milestoneAmounts: ["0.1", "0.12", "0.1"],
    minWorkerStake: "0.05", // worker must stake this bond once, covers all 3 milestones
  });
  console.log("milestone job created:", jobId);

  await worker.stakeBond("0.05"); // required once, before the first delivery

  for (let i = 0; i < 3; i++) {
    await worker.deliverMilestone({ jobId, milestoneIndex: i, deliverable: `Part ${i + 1}...` });
    await verifier.submitMilestoneVerdict({ jobId, milestoneIndex: i, score: 95, rationale: "Meets criteria." });
    const { txHash } = await buyer.settleMilestone({ jobId, milestoneIndex: i });
    console.log(`milestone ${i} settled:`, txHash);
  }

  const rep = await buyer.getReputation(workerWallet.account.address);
  console.log("worker reputation now:", rep.score);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

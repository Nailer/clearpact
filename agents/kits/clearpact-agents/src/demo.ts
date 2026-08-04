import { runBuyer } from './roles/buyer';
import { runWorker } from './roles/worker';
import { runVerifier } from './roles/verifier';
import * as chain from './chain';

function required(name: string): `0x${string}` {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in .env — run \`circle wallet create\` and record the addresses.`);
  return v as `0x${string}`;
}

const BUYER = required('BUYER_AGENT_ADDRESS');
const WORKER = required('WORKER_AGENT_ADDRESS');
const VERIFIER = required('VERIFIER_AGENT_ADDRESS');

function section(title: string) {
  console.log(`\n${'='.repeat(70)}\n${title}\n${'='.repeat(70)}`);
}

function findJobId(toolCalls: { tool: string; output: unknown }[]): number {
  for (const c of toolCalls) {
    if (c.tool === 'create_job') {
      const parsed = JSON.parse(String(c.output));
      return parsed.jobId;
    }
  }
  throw new Error('Agent never called create_job');
}

async function actOne() {
  section('ACT 1 — honest work, autonomously negotiated and settled');

  const buyerBrief =
    `Post a job for the worker at ${WORKER}, graded by the verifier at ${VERIFIER}. ` +
    `The job: "Write a 3-sentence plain-language explanation of how ClearPact's escrow works, ` +
    `suitable for a non-technical reader. Must mention: (1) funds are locked until work is verified, ` +
    `(2) a verifier agent grades the work, (3) payment is automatic on a passing grade." ` +
    `Escrow 0.3 USDC. Require a worker bond given this is the worker's first job with you.`;
  const buyerResult = await runBuyer(BUYER, buyerBrief);
  console.log('\n[buyer]', buyerResult.text);
  const jobId = findJobId(buyerResult.toolCalls);
  console.log(`  → jobId=${jobId}`);

  const workerBrief =
    `You've been assigned job #${jobId} by a buyer. Fetch nothing else — here is the full job spec: ` +
    `"Write a 3-sentence plain-language explanation of how ClearPact's escrow works, suitable for a ` +
    `non-technical reader. Must mention: (1) funds are locked until work is verified, (2) a verifier ` +
    `agent grades the work, (3) payment is automatic on a passing grade." ` +
    `If the job requires a bond, stake at least 1.0 USDC first. Then deliver your real, complete answer.`;
  const workerResult = await runWorker(WORKER, workerBrief);
  console.log('\n[worker]', workerResult.text);

  const deliverCall = workerResult.toolCalls.find((c) => c.tool === 'deliver_work');
  const deliveredText = (deliverCall?.input as any)?.deliverableText ?? '(not found)';

  const verifierBrief =
    `Grade job #${jobId}. Acceptance criteria: "Write a 3-sentence plain-language explanation of how ` +
    `ClearPact's escrow works, suitable for a non-technical reader. Must mention: (1) funds are locked ` +
    `until work is verified, (2) a verifier agent grades the work, (3) payment is automatic on a passing ` +
    `grade." The worker's delivered text: """${deliveredText}"""`;
  const verifierResult = await runVerifier(VERIFIER, verifierBrief);
  console.log('\n[verifier]', verifierResult.text);

  await new Promise((r) => setTimeout(r, 3000));
  const settleTx = await chain.settle(BUYER, jobId);
  console.log(`\n[settle] job #${jobId} →`, settleTx);

  const rep = await chain.reputationScore(WORKER);
  console.log(`[reputation] worker score is now ${rep}`);
}

async function actTwo() {
  section('ACT 2 — a bad delivery, caught and slashed');

  const buyerBrief =
    `Post a job for the worker at ${WORKER}, graded by the verifier at ${VERIFIER}. ` +
    `The job: "Write a complete, accurate 5-item bullet list of ClearPact's on-chain guarantees: ` +
    `escrow, verifier-triggered settlement, dispute window, worker bonds, and on-chain reputation. ` +
    `Each bullet must name the guarantee and explain it in one sentence." ` +
    `Escrow 0.3 USDC. Require a worker bond of 1.0 USDC.`;
  const buyerResult = await runBuyer(BUYER, buyerBrief);
  console.log('\n[buyer]', buyerResult.text);
  const jobId = findJobId(buyerResult.toolCalls);
  console.log(`  → jobId=${jobId}`);

  const workerBrief =
    `You've been assigned job #${jobId}. Stake a bond of at least 1.0 USDC if required, then deliver ` +
    `this exact low-effort, incomplete text as your work (this simulates a worker cutting corners — ` +
    `delvier it verbatim, do not improve it): "USDC escrow is good."`;
  const workerResult = await runWorker(WORKER, workerBrief);
  console.log('\n[worker]', workerResult.text);

  const deliverCall = workerResult.toolCalls.find((c) => c.tool === 'deliver_work');
  const deliveredText = (deliverCall?.input as any)?.deliverableText ?? '(not found)';

  const verifierBrief =
    `Grade job #${jobId}. Acceptance criteria: "Write a complete, accurate 5-item bullet list of ` +
    `ClearPact's on-chain guarantees: escrow, verifier-triggered settlement, dispute window, worker ` +
    `bonds, and on-chain reputation. Each bullet must name the guarantee and explain it in one ` +
    `sentence." The worker's delivered text: """${deliveredText}"""`;
  const verifierResult = await runVerifier(VERIFIER, verifierBrief);
  console.log('\n[verifier]', verifierResult.text);

  await new Promise((r) => setTimeout(r, 2000));

  console.log('\n[worker disputes the failing verdict]');
  const disputeTx = await chain.disputeJob(WORKER, jobId);
  console.log('  →', disputeTx);

  console.log('\n[arbiter rules: worker loses, bond partially slashed to buyer]');
  const arbitrateTx = await chain.arbitrate(jobId, 1000, 5000); // 10% of escrow to worker, 50% of bond slashed
  console.log('  →', arbitrateTx);

  const rep = await chain.reputationScore(WORKER);
  console.log(`[reputation] worker score is now ${rep} (dropped after the lost dispute)`);
}

async function main() {
  console.log('ClearPact agent demo — buyer, worker, verifier acting autonomously on Arc testnet.');
  console.log(`buyer=${BUYER}\nworker=${WORKER}\nverifier=${VERIFIER}`);

  await actOne();
  await actTwo();

  section('done');
}

main().catch((e) => {
  console.error('demo failed:', e);
  process.exit(1);
});

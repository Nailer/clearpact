import { runBuyer } from './roles/buyer';
import { runWorker } from './roles/worker';
import { runVerifier } from './roles/verifier';
import * as chain from './chain';

function required(name: string): `0x${string}` {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in .env`);
  return v as `0x${string}`;
}

const BUYER = required('BUYER_AGENT_ADDRESS');
const WORKER = required('NEWCOMER_WORKER_ADDRESS'); // fresh, zero-balance wallet — see Part 5 sponsorship story
const VERIFIER = required('VERIFIER_AGENT_ADDRESS');

function section(title: string) {
  console.log(`\n${'='.repeat(70)}\n${title}\n${'='.repeat(70)}`);
}

type ToolCall = { tool: string; input: unknown; output: unknown };

function findJobId(toolCalls: ToolCall[]): number {
  for (const c of toolCalls) {
    if (c.tool === 'create_milestone_job') return (c.output as { jobId: number }).jobId;
  }
  throw new Error('Agent never called create_milestone_job');
}

function findDisputeWindowSeconds(toolCalls: ToolCall[]): number {
  for (const c of toolCalls) {
    if (c.tool === 'create_milestone_job') return (c.input as { disputeWindowSeconds: number }).disputeWindowSeconds;
  }
  throw new Error('Agent never called create_milestone_job');
}

async function wait(seconds: number) {
  console.log(`  ...waiting ${seconds}s for the dispute window to close...`);
  await new Promise((r) => setTimeout(r, seconds * 1000));
}

async function main() {
  console.log('ClearPact nanopayments demo — a genuinely new agent, sponsored and paid in 3 streaming installments.');
  console.log(`buyer=${BUYER}\nnewcomer worker=${WORKER} (zero balance until sponsored)\nverifier=${VERIFIER}`);

  section('STEP 1 — sponsoring a brand-new agent (Arc\'s answer to "Paymaster")');
  console.log(`worker balance before sponsorship: ${await chain.freeStakeOf(WORKER)} wei bond (irrelevant — checking wallet, not bond)`);

  const sponsorBrief =
    `A brand-new worker agent at ${WORKER} has zero USDC and cannot yet afford gas or a bond. It will ` +
    `need to pay gas for roughly 4-5 transactions, stake a small bond, and afterwards deposit some of ` +
    `its earnings into Circle Gateway (which has a 0.5 USDC minimum deposit) over the course of a ` +
    `3-milestone job you're about to hire it for. Decide a fair, generous starter grant — around 0.8 ` +
    `USDC — and send it directly with sponsor_worker so it can actually operate through the whole job. ` +
    `This is Arc's native alternative to a separate Paymaster product: gas and payment are the same ` +
    `currency here, so a plain USDC transfer solves the bootstrap problem.`;
  const sponsorResult = await runBuyer(BUYER, sponsorBrief);
  console.log('\n[buyer]', sponsorResult.text);

  section('STEP 2 — buyer posts a 3-milestone job (nanopayments: pay per verified chunk)');
  const buyerBrief =
    `Post a 3-milestone job for the newly-sponsored worker at ${WORKER}, graded by the verifier at ` +
    `${VERIFIER}. The job is building a short project README in three stages: ` +
    `Milestone 1: write a one-paragraph project summary. ` +
    `Milestone 2: write a bullet-point list of exactly 3 key features. ` +
    `Milestone 3: write a one-sentence installation instruction. ` +
    `Each milestone is graded and paid independently as it's delivered — the worker doesn't wait for ` +
    `the whole README to be done to get paid for the summary. Size each milestone around 0.1-0.15 USDC. ` +
    `This is a brand-new worker with a small sponsored balance, so require a small bond it can actually ` +
    `afford, and use a short dispute window well under 60 seconds — this is a live demo.`;
  const buyerResult = await runBuyer(BUYER, buyerBrief);
  console.log('\n[buyer]', buyerResult.text);
  const jobId = findJobId(buyerResult.toolCalls);
  const disputeWindow = findDisputeWindowSeconds(buyerResult.toolCalls);
  console.log(`  → jobId=${jobId}, disputeWindow=${disputeWindow}s`);

  const milestoneBriefs = [
    'Write a one-paragraph project summary for ClearPact, a trust and escrow protocol for AI agents on Arc.',
    'Write a bullet-point list of exactly 3 key features of ClearPact.',
    'Write a one-sentence installation instruction for a TypeScript project using bun.',
  ];

  for (let i = 0; i < 3; i++) {
    section(`STEP ${3 + i} — milestone ${i}: deliver, grade, and settle independently`);

    const workerBrief =
      `You've been assigned milestone ${i} of job #${jobId}, a MilestoneEscrow job (use ` +
      `get_milestone_status, not get_job_status, if you want to check its state — this job's id may ` +
      `overlap with unrelated jobs on the other escrow contract). If this is your first delivery on ` +
      `this job and it requires a bond, check your free stake with get_reputation and stake enough to ` +
      `cover it first. Then deliver milestone ${i}: "${milestoneBriefs[i]}"`;
    const workerResult = await runWorker(WORKER, workerBrief);
    console.log('\n[worker]', workerResult.text);

    const deliverCall = workerResult.toolCalls.find((c) => c.tool === 'deliver_milestone');
    const deliveredText = (deliverCall?.input as any)?.deliverableText ?? '(not found)';

    const verifierBrief =
      `Grade milestone ${i} of job #${jobId} (a MilestoneEscrow job — use submit_milestone_verdict, not ` +
      `submit_verdict). Acceptance criteria for this milestone: "${milestoneBriefs[i]}" The worker's ` +
      `delivered text: """${deliveredText}"""`;
    const verifierResult = await runVerifier(VERIFIER, verifierBrief);
    console.log('\n[verifier]', verifierResult.text);

    await wait(disputeWindow + 5);
    const settleTx = await chain.settleMilestone(BUYER, jobId, i);
    console.log(`[settle] milestone ${i} →`, settleTx);
  }

  section('STEP 6 — worker routes its earnings through Circle Gateway (Nanopayments rail)');
  const gatewayResult = await chain.gatewayDeposit(WORKER, '0.5');
  console.log('[gateway deposit]', JSON.stringify(gatewayResult, null, 2));
  const balance = await chain.gatewayBalance(WORKER);
  console.log('[gateway balance]', JSON.stringify(balance, null, 2));

  const rep = await chain.reputationScore(WORKER);
  console.log(`\n[reputation] newcomer worker's score after 3 verified milestones: ${rep}`);

  section('done');
}

main().catch((e) => {
  console.error('demo failed:', e);
  process.exit(1);
});

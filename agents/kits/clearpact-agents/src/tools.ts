import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import * as chain from './chain';

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

/** Side-channel call log: each tool invocation records itself here directly,
 *  rather than the caller trying to reconstruct tool_use/tool_result pairs
 *  from the SDK's streamed message shape (fragile — see run.ts history). */
export type RecordedCall = { tool: string; input: unknown; output: unknown };
let recorder: RecordedCall[] = [];
export function resetRecorder(): void {
  recorder = [];
}
export function getRecordedCalls(): RecordedCall[] {
  return recorder;
}

function ok(name: string, input: unknown, value: unknown): ToolResult {
  recorder.push({ tool: name, input, output: value });
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function err(e: unknown): ToolResult {
  const message = e instanceof Error ? e.message : String(e);
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
}

const readOnlyTools = [
  tool(
    'get_job_status',
    'Read a single-payment ClearPactEscrow job\'s on-chain status (NOT for milestone/multi-payment jobs ' +
      '— use get_milestone_status for those; the two contracts have separate, overlapping jobId counters). ' +
      'Returns a status code: 1=Created, 2=Delivered, 3=Verified, 4=Disputed, 5=Released, 6=Refunded, 7=Resolved.',
    { jobId: z.number().int().describe('The job id.') },
    async ({ jobId }): Promise<ToolResult> => {
      try {
        return ok('get_job_status', { jobId }, { jobId, status: await chain.getJobStatus(jobId) });
      } catch (e) {
        return err(e);
      }
    },
  ),
  tool(
    'get_milestone_status',
    'Read one milestone\'s on-chain status from a MilestoneEscrow (multi-payment) job — use this, not ' +
      'get_job_status, for any job created with create_milestone_job. Returns a status code: ' +
      '1=Created, 2=Delivered, 3=Verified, 4=Disputed, 5=Released, 6=Refunded, 7=Resolved.',
    { jobId: z.number().int(), milestoneIndex: z.number().int().min(0).max(2) },
    async ({ jobId, milestoneIndex }): Promise<ToolResult> => {
      try {
        const status = await chain.getMilestoneStatus(jobId, milestoneIndex);
        return ok('get_milestone_status', { jobId, milestoneIndex }, { jobId, milestoneIndex, status });
      } catch (e) {
        return err(e);
      }
    },
  ),
  tool(
    'get_reputation',
    'Read an agent\'s on-chain ClearPact reputation score (0-100; newcomers start at 50) and free (unlocked) USDC bond.',
    { address: z.string().describe('EVM address to look up.') },
    async ({ address }): Promise<ToolResult> => {
      try {
        const [score, freeStake] = await Promise.all([
          chain.reputationScore(address as `0x${string}`),
          chain.freeStakeOf(address as `0x${string}`),
        ]);
        return ok('get_reputation', { address }, { address, reputationScore: score, freeStakeWei: freeStake });
      } catch (e) {
        return err(e);
      }
    },
  ),
];

/** Buyer: creates and funds a job; can also dispute after a verdict. */
export function buildBuyerServer(buyerWallet: `0x${string}`) {
  const tools = [
    ...readOnlyTools,
    tool(
      'create_job',
      'Escrow native USDC on Arc for a job. Hashes the job description on-chain as the ' +
        'spec commitment. Returns the new jobId.',
      {
        worker: z.string().describe('Worker agent wallet address (0x...).'),
        verifier: z.string().describe('Verifier agent wallet address (0x...).'),
        jobDescription: z
          .string()
          .describe('Full job spec and acceptance criteria in plain text; hashed on-chain as the commitment.'),
        passScore: z.number().int().min(0).max(100).describe('Minimum verifier score (0-100) that counts as acceptance.'),
        deadlineMinutesFromNow: z.number().int().positive().describe('Worker must deliver within this many minutes.'),
        disputeWindowSeconds: z.number().int().positive().describe('Seconds after a verdict during which either side may dispute.'),
        minWorkerStakeUsdc: z.string().describe('USDC bond the worker must have staked to accept this job, e.g. "1.0". Use "0" for no bond requirement.'),
        escrowAmountUsdc: z.string().describe('USDC amount to escrow for the job, e.g. "0.4".'),
      },
      async (input): Promise<ToolResult> => {
        try {
          const specHash = await chain.keccak256Of(input.jobDescription);
          const deadline = Math.floor(Date.now() / 1000) + input.deadlineMinutesFromNow * 60;
          const { jobId, tx } = await chain.createJob(
            buyerWallet,
            input.worker as `0x${string}`,
            input.verifier as `0x${string}`,
            specHash,
            input.passScore,
            deadline,
            input.disputeWindowSeconds,
            input.minWorkerStakeUsdc,
            input.escrowAmountUsdc,
          );
          return ok('create_job', input, { jobId, specHash, ...tx });
        } catch (e) {
          return err(e);
        }
      },
    ),
    tool(
      'dispute_job',
      'Escalate a verified job you believe was graded wrongly. Only valid inside the dispute window.',
      { jobId: z.number().int() },
      async ({ jobId }): Promise<ToolResult> => {
        try {
          return ok('dispute_job', { jobId }, await chain.disputeJob(buyerWallet, jobId));
        } catch (e) {
          return err(e);
        }
      },
    ),
    tool(
      'create_milestone_job',
      'Escrow native USDC on Arc for a job paid in 3 milestones — the worker gets paid for each ' +
        'verified chunk as it completes, instead of one lump sum at the end (ClearPact\'s nanopayment ' +
        'rail). Use this for a job that naturally breaks into distinct stages of work.',
      {
        worker: z.string().describe('Worker agent wallet address (0x...).'),
        verifier: z.string().describe('Verifier agent wallet address (0x...).'),
        jobDescription: z
          .string()
          .describe('Full job spec and acceptance criteria for ALL 3 milestones, in plain text; hashed on-chain.'),
        passScore: z.number().int().min(0).max(100).describe('Minimum verifier score (0-100) per milestone that counts as acceptance.'),
        deadlineMinutesFromNow: z.number().int().positive().describe('All milestones must be delivered by this time.'),
        disputeWindowSeconds: z.number().int().positive().describe('Seconds after each milestone verdict during which either side may dispute.'),
        minWorkerStakeUsdc: z.string().describe('USDC bond the worker must have staked (covers the whole job, locked once). Use "0" for no bond.'),
        milestone1Usdc: z.string().describe('USDC amount for milestone 1, e.g. "0.1".'),
        milestone2Usdc: z.string().describe('USDC amount for milestone 2.'),
        milestone3Usdc: z.string().describe('USDC amount for milestone 3.'),
      },
      async (input): Promise<ToolResult> => {
        try {
          const specHash = await chain.keccak256Of(input.jobDescription);
          const deadline = Math.floor(Date.now() / 1000) + input.deadlineMinutesFromNow * 60;
          const { jobId, tx } = await chain.createMilestoneJob3(
            buyerWallet,
            input.worker as `0x${string}`,
            input.verifier as `0x${string}`,
            specHash,
            input.passScore,
            deadline,
            input.disputeWindowSeconds,
            input.minWorkerStakeUsdc,
            [input.milestone1Usdc, input.milestone2Usdc, input.milestone3Usdc],
          );
          return ok('create_milestone_job', input, { jobId, specHash, ...tx });
        } catch (e) {
          return err(e);
        }
      },
    ),
    tool(
      'sponsor_worker',
      'Send a small native-USDC starter grant directly to a worker\'s wallet, so a brand-new agent ' +
        'with no funds can afford to stake a bond and pay its own gas for its first job. On Arc, gas ' +
        'and the payment currency are the same token (USDC), so this single transfer solves the ' +
        '"new agent needs money to make money" bootstrap problem that a separate Paymaster product ' +
        'exists to solve elsewhere.',
      {
        workerAddress: z.string().describe('The worker wallet to fund (0x...).'),
        amountUsdc: z.string().describe('Amount to send, e.g. "0.2".'),
      },
      async ({ workerAddress, amountUsdc }): Promise<ToolResult> => {
        try {
          const tx = await chain.sponsorWorker(buyerWallet, workerAddress as `0x${string}`, amountUsdc);
          return ok('sponsor_worker', { workerAddress, amountUsdc }, tx);
        } catch (e) {
          return err(e);
        }
      },
    ),
  ];
  return createSdkMcpServer({ name: 'clearpact_buyer', version: '0.0.0', tools });
}

/** Worker: stakes a bond, delivers work, can dispute a verdict it disagrees with. */
export function buildWorkerServer(workerWallet: `0x${string}`) {
  const tools = [
    ...readOnlyTools,
    tool(
      'stake_bond',
      'Post a native-USDC bond to the ClearPact reputation registry. Required before delivering on a bonded job ("no bond, no work").',
      { amountUsdc: z.string().describe('Amount to stake, e.g. "1.0".') },
      async ({ amountUsdc }): Promise<ToolResult> => {
        try {
          return ok('stake_bond', { amountUsdc }, await chain.stake(workerWallet, amountUsdc));
        } catch (e) {
          return err(e);
        }
      },
    ),
    tool(
      'deliver_work',
      'Submit the deliverable for a job. The deliverable text is hashed on-chain as proof of delivery.',
      {
        jobId: z.number().int(),
        deliverableText: z.string().describe('The actual work product, in full.'),
      },
      async ({ jobId, deliverableText }): Promise<ToolResult> => {
        try {
          const hash = await chain.keccak256Of(deliverableText);
          const tx = await chain.deliver(workerWallet, jobId, hash);
          return ok('deliver_work', { jobId, deliverableText }, { jobId, deliverableHash: hash, ...tx });
        } catch (e) {
          return err(e);
        }
      },
    ),
    tool(
      'dispute_job',
      'Escalate a verified job you believe was graded wrongly. Only valid inside the dispute window.',
      { jobId: z.number().int() },
      async ({ jobId }): Promise<ToolResult> => {
        try {
          return ok('dispute_job', { jobId }, await chain.disputeJob(workerWallet, jobId));
        } catch (e) {
          return err(e);
        }
      },
    ),
    tool(
      'deliver_milestone',
      'Submit the deliverable for one milestone of a multi-milestone job. The bond (if the job ' +
        'requires one) locks on your FIRST milestone delivery only — it covers the whole job, not ' +
        'each milestone separately.',
      {
        jobId: z.number().int(),
        milestoneIndex: z.number().int().min(0).max(2).describe('Which milestone (0, 1, or 2).'),
        deliverableText: z.string().describe('The actual work product for this milestone, in full.'),
      },
      async ({ jobId, milestoneIndex, deliverableText }): Promise<ToolResult> => {
        try {
          const hash = await chain.keccak256Of(deliverableText);
          const tx = await chain.deliverMilestone(workerWallet, jobId, milestoneIndex, hash);
          return ok('deliver_milestone', { jobId, milestoneIndex, deliverableText }, {
            jobId,
            milestoneIndex,
            deliverableHash: hash,
            ...tx,
          });
        } catch (e) {
          return err(e);
        }
      },
    ),
    tool(
      'dispute_milestone',
      'Escalate a verified milestone you believe was graded wrongly. Only valid inside that milestone\'s dispute window.',
      { jobId: z.number().int(), milestoneIndex: z.number().int().min(0).max(2) },
      async ({ jobId, milestoneIndex }): Promise<ToolResult> => {
        try {
          return ok('dispute_milestone', { jobId, milestoneIndex }, await chain.disputeMilestone(workerWallet, jobId, milestoneIndex));
        } catch (e) {
          return err(e);
        }
      },
    ),
    tool(
      'deposit_to_gateway',
      'Deposit your earned USDC into Circle Gateway — the batched, gas-free settlement rail ' +
        'Circle Nanopayments runs on. Use this after being paid, to hold funds ready for cheap, ' +
        'high-frequency onward payments (e.g. paying other x402 services) instead of raw wallet balance. ' +
        'Minimum deposit is 0.5 USDC.',
      { amountUsdc: z.string().describe('Amount to deposit, minimum "0.5".') },
      async ({ amountUsdc }): Promise<ToolResult> => {
        try {
          const result = await chain.gatewayDeposit(workerWallet, amountUsdc);
          return ok('deposit_to_gateway', { amountUsdc }, result);
        } catch (e) {
          return err(e);
        }
      },
    ),
  ];
  return createSdkMcpServer({ name: 'clearpact_worker', version: '0.0.0', tools });
}

/** Verifier: grades a delivered job and posts the verdict on-chain. */
export function buildVerifierServer(verifierWallet: `0x${string}`) {
  const tools = [
    ...readOnlyTools,
    tool(
      'submit_verdict',
      'Post your grading verdict for a delivered job on-chain. The verdict rationale is hashed as a ' +
        'permanent, checkable record of why you scored it this way. This is the sole trigger for ' +
        'settlement: score >= the job\'s passScore releases funds to the worker, otherwise they refund ' +
        'to the buyer. Grade honestly against the acceptance criteria — do not inflate or deflate the score.',
      {
        jobId: z.number().int(),
        score: z.number().int().min(0).max(100).describe('Your grade, 0-100, strictly against the stated acceptance criteria.'),
        verdictRationale: z.string().describe('Your reasoning for this score, in full — this is hashed on-chain.'),
      },
      async ({ jobId, score, verdictRationale }): Promise<ToolResult> => {
        try {
          const hash = await chain.keccak256Of(verdictRationale);
          const tx = await chain.submitVerdict(verifierWallet, jobId, score, hash);
          return ok('submit_verdict', { jobId, score, verdictRationale }, { jobId, score, verdictHash: hash, ...tx });
        } catch (e) {
          return err(e);
        }
      },
    ),
    tool(
      'submit_milestone_verdict',
      'Post your grading verdict for one milestone of a multi-milestone job. This releases (or ' +
        'refunds) JUST that milestone\'s USDC — other milestones settle independently as they\'re ' +
        'delivered and graded. Grade honestly against the acceptance criteria for this specific milestone.',
      {
        jobId: z.number().int(),
        milestoneIndex: z.number().int().min(0).max(2),
        score: z.number().int().min(0).max(100).describe('Your grade, 0-100, strictly against this milestone\'s acceptance criteria.'),
        verdictRationale: z.string().describe('Your reasoning for this score, in full — this is hashed on-chain.'),
      },
      async ({ jobId, milestoneIndex, score, verdictRationale }): Promise<ToolResult> => {
        try {
          const hash = await chain.keccak256Of(verdictRationale);
          const tx = await chain.submitMilestoneVerdict(verifierWallet, jobId, milestoneIndex, score, hash);
          return ok('submit_milestone_verdict', { jobId, milestoneIndex, score, verdictRationale }, {
            jobId,
            milestoneIndex,
            score,
            verdictHash: hash,
            ...tx,
          });
        } catch (e) {
          return err(e);
        }
      },
    ),
  ];
  return createSdkMcpServer({ name: 'clearpact_verifier', version: '0.0.0', tools });
}

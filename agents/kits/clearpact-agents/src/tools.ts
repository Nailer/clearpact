import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import * as chain from './chain';

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function ok(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function err(e: unknown): ToolResult {
  const message = e instanceof Error ? e.message : String(e);
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
}

const readOnlyTools = [
  tool(
    'get_job_status',
    'Read a ClearPact job\'s on-chain status. Returns a status code: 1=Created, 2=Delivered, 3=Verified, 4=Disputed, 5=Released, 6=Refunded, 7=Resolved.',
    { jobId: z.number().int().describe('The job id.') },
    async ({ jobId }): Promise<ToolResult> => {
      try {
        return ok({ jobId, status: await chain.getJobStatus(jobId) });
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
        return ok({ address, reputationScore: score, freeStakeWei: freeStake });
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
          return ok({ jobId, specHash, ...tx });
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
          return ok(await chain.disputeJob(buyerWallet, jobId));
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
          return ok(await chain.stake(workerWallet, amountUsdc));
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
          return ok({ jobId, deliverableHash: hash, ...tx });
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
          return ok(await chain.disputeJob(workerWallet, jobId));
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
          return ok({ jobId, score, verdictHash: hash, ...tx });
        } catch (e) {
          return err(e);
        }
      },
    ),
  ];
  return createSdkMcpServer({ name: 'clearpact_verifier', version: '0.0.0', tools });
}

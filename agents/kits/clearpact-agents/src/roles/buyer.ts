import { buildBuyerServer } from '../tools';
import { runAgent, type AgentTurnResult } from '../run';

const SYSTEM_PROMPT = `You are a buyer agent on ClearPact, a trust and settlement protocol for the \
AI agent economy running on Arc (Circle's stablecoin L1). You hire worker agents to do jobs, \
paying in escrowed USDC that only releases once a verifier agent grades the delivered work.

Given a job brief, you must:
1. Decide fair, specific acceptance criteria and fold them into the job description you escrow \
   on-chain (specHash commits to this text — the worker and verifier both see it).
2. Choose a reasonable passScore (usually 70-80 for standard work).
3. Choose a deadline and a short dispute window (a few minutes is fine for this demo).
4. Decide whether to require a worker bond (minWorkerStakeUsdc) given the job's value and risk — \
   for a job worth escrowAmountUsdc, a bond of similar or greater size gives you real recourse.
5. Call create_job exactly once with your decisions.

Report the jobId and your reasoning briefly at the end.`;

export async function runBuyer(
  buyerWallet: `0x${string}`,
  brief: string,
): Promise<AgentTurnResult> {
  const server = buildBuyerServer(buyerWallet);
  return runAgent(SYSTEM_PROMPT, brief, server, 'clearpact_buyer');
}

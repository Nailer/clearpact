import { buildWorkerServer } from '../tools';
import { runAgent, type AgentTurnResult } from '../run';

const SYSTEM_PROMPT = `You are a worker agent on ClearPact, a trust and settlement protocol for the \
AI agent economy running on Arc. You accept jobs and deliver real work; you are paid in USDC only \
after a verifier agent grades your delivery against the job's stated acceptance criteria.

Given a job assignment, you must:
1. If the job requires a minimum bond, call stake_bond for at least that amount before delivering \
   ("no bond, no work" is enforced on-chain — delivery reverts if you're underbonded).
2. Actually do the work described, to the best of your ability, and produce a real, complete \
   deliverable — not a placeholder.
3. Call deliver_work with the full deliverable text and the jobId.

Report what you produced and your delivery tx briefly at the end.`;

export async function runWorker(
  workerWallet: `0x${string}`,
  assignment: string,
): Promise<AgentTurnResult> {
  const server = buildWorkerServer(workerWallet);
  return runAgent(SYSTEM_PROMPT, assignment, server, 'clearpact_worker');
}

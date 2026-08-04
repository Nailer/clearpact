import { buildVerifierServer } from '../tools';
import { runAgent, type AgentTurnResult } from '../run';

const SYSTEM_PROMPT = `You are a verifier agent on ClearPact, a trust and settlement protocol for the \
AI agent economy running on Arc. You are the "real signal" the protocol settles on: your grade of a \
delivered job is the sole trigger that releases escrowed USDC to the worker or refunds it to the buyer.

Given a job's acceptance criteria and the worker's actual deliverable, you must:
1. Grade the deliverable strictly and honestly against the stated acceptance criteria — nothing else. \
   Do not be swayed by effort, length, or tone if the substance does not meet the criteria. Do not \
   inflate a weak delivery out of leniency, and do not deflate a strong one out of excessive strictness.
2. Call submit_verdict exactly once with the jobId, your 0-100 score, and a clear rationale explaining \
   specifically which criteria were met or missed.

Report your verdict and reasoning briefly at the end.`;

export async function runVerifier(
  verifierWallet: `0x${string}`,
  gradingBrief: string,
): Promise<AgentTurnResult> {
  const server = buildVerifierServer(verifierWallet);
  return runAgent(SYSTEM_PROMPT, gradingBrief, server, 'clearpact_verifier');
}

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  CHAIN,
  ESCROW_ADDRESS,
  REGISTRY_ADDRESS,
  MILESTONE_ESCROW_ADDRESS,
  ARBITER_ADDRESS,
  ARBITER_PRIVATE_KEY,
} from './config';

const execFileAsync = promisify(execFile);

/** Resolved once per process: prefer PATH, fall back to the bun global bin. */
let circleBin: string | null = null;
async function resolveCircleBin(): Promise<string> {
  if (circleBin) return circleBin;
  circleBin = 'circle';
  try {
    await execFileAsync('circle', ['--version']);
  } catch {
    circleBin = `${process.env.HOME}/.bun/bin/circle`;
  }
  return circleBin;
}

async function circleJson(args: string[]): Promise<any> {
  const bin = await resolveCircleBin();
  const { stdout } = await execFileAsync(bin, [...args, '--output', 'json'], {
    maxBuffer: 8 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout);
  if (parsed?.error) throw new Error(parsed.error.message ?? JSON.stringify(parsed.error));
  return parsed.data ?? parsed;
}

/** A Circle-managed agent wallet executes a write call on ClearPact contracts. */
async function execute(
  wallet: `0x${string}`,
  contract: `0x${string}`,
  signature: string,
  params: (string | number)[],
  amountUsdc?: string,
): Promise<{ txHash?: string; txId?: string; raw: any }> {
  const args = [
    'wallet',
    'execute',
    signature,
    ...params.map(String),
    '--contract',
    contract,
    '--address',
    wallet,
    '--chain',
    CHAIN,
  ];
  if (amountUsdc) args.push('--amount', amountUsdc);
  const raw = await circleJson(args);
  return { txHash: raw?.transactionHash ?? raw?.txHash, txId: raw?.transactionId ?? raw?.txId, raw };
}

/** Read-only ABI call against a ClearPact contract. Uses `cast call` rather
 *  than `circle contract query`: the Circle CLI's query command only accepts
 *  an input-only signature and returns raw undecoded hex (`outputData`),
 *  whereas `cast call` decodes named return types directly — reliable and
 *  already proven in Parts 2/3. Reads are not part of the "agents acting
 *  through Circle Wallets" story (writes are); this only affects how we look
 *  values up. */
async function query(contract: `0x${string}`, signature: string, params: (string | number)[] = []): Promise<string> {
  const rpc = process.env.ARC_TESTNET_RPC!;
  const { stdout } = await execFileAsync('cast', [
    'call',
    contract,
    signature,
    ...params.map(String),
    '--rpc-url',
    rpc,
  ]);
  return stdout.trim();
}

// ── Escrow — buyer ──────────────────────────────────────────────────────

/** `cast call`'s plain-text output for a numeric return is `<digits>` or
 *  `<digits> [<scientific-notation>]` for large values — the leading token is
 *  always the exact decimal value. */
function parseCastUint(output: string): bigint {
  const token = output.trim().split(/\s/)[0];
  if (!token) throw new Error(`cast call returned empty output`);
  return BigInt(token);
}

export async function nextJobId(): Promise<number> {
  const result = await query(ESCROW_ADDRESS, 'nextJobId()(uint256)');
  return Number(parseCastUint(result));
}

export async function createJob(
  buyerWallet: `0x${string}`,
  worker: `0x${string}`,
  verifier: `0x${string}`,
  specHash: `0x${string}`,
  passScore: number,
  deadline: number,
  disputeWindowSeconds: number,
  minWorkerStakeUsdc: string,
  escrowAmountUsdc: string,
): Promise<{ jobId: number; tx: { txHash?: string; txId?: string } }> {
  const jobId = await nextJobId();
  // minWorkerStake is a uint96 in *wei* (18-decimal native USDC); the CLI's
  // ABI-parameter args are raw, unlike --amount which is human-readable.
  const minStakeWei = BigInt(Math.round(Number(minWorkerStakeUsdc) * 1e18)).toString();
  const tx = await execute(
    buyerWallet,
    ESCROW_ADDRESS,
    'createJob(address,address,bytes32,uint8,uint64,uint32,uint96)',
    [worker, verifier, specHash, passScore, deadline, disputeWindowSeconds, minStakeWei],
    escrowAmountUsdc,
  );
  return { jobId, tx };
}

// ── Escrow — worker ──────────────────────────────────────────────────────

export async function deliver(
  workerWallet: `0x${string}`,
  jobId: number,
  deliverableHash: `0x${string}`,
): Promise<{ txHash?: string; txId?: string }> {
  return execute(workerWallet, ESCROW_ADDRESS, 'deliver(uint256,bytes32)', [jobId, deliverableHash]);
}

export async function disputeJob(workerOrBuyerWallet: `0x${string}`, jobId: number) {
  return execute(workerOrBuyerWallet, ESCROW_ADDRESS, 'dispute(uint256)', [jobId]);
}

// ── Escrow — verifier ────────────────────────────────────────────────────

export async function submitVerdict(
  verifierWallet: `0x${string}`,
  jobId: number,
  score: number,
  verdictHash: `0x${string}`,
): Promise<{ txHash?: string; txId?: string }> {
  return execute(verifierWallet, ESCROW_ADDRESS, 'submitVerdict(uint256,uint8,bytes32)', [
    jobId,
    score,
    verdictHash,
  ]);
}

// ── Escrow — anyone ──────────────────────────────────────────────────────

export async function settle(callerWallet: `0x${string}`, jobId: number) {
  return execute(callerWallet, ESCROW_ADDRESS, 'settle(uint256)', [jobId]);
}

export async function getJobStatus(jobId: number): Promise<number> {
  // Job.status is the 13th field of the returned tuple (0-indexed: 12).
  const result = await query(
    ESCROW_ADDRESS,
    'getJob(uint256)((address,address,address,uint96,bytes32,bytes32,bytes32,uint64,uint32,uint64,uint8,uint8,uint8,uint96,uint96))',
    [jobId],
  );
  // cast prints a tuple as a parenthesized, comma-separated line.
  const fields = result.replace(/^\(|\)$/g, '').split(', ');
  return Number(fields[12]);
}

// ── Reputation registry ──────────────────────────────────────────────────

export async function stake(workerWallet: `0x${string}`, amountUsdc: string) {
  return execute(workerWallet, REGISTRY_ADDRESS, 'stake()', [], amountUsdc);
}

export async function reputationScore(agent: `0x${string}`): Promise<number> {
  const result = await query(REGISTRY_ADDRESS, 'reputationScore(address)(uint256)', [agent]);
  return Number(parseCastUint(result));
}

export async function freeStakeOf(agent: `0x${string}`): Promise<string> {
  const result = await query(REGISTRY_ADDRESS, 'freeStakeOf(address)(uint256)', [agent]);
  return parseCastUint(result).toString();
}

// ── Arbitration (protocol admin — raw-signed, see config.ts) ────────────

/** Arbitrate is signed directly with the deployer/arbiter key via `cast`,
 *  since it is a protocol admin action outside the agent-to-agent flow and
 *  `circle wallet import` requires an interactive TTY that cannot be
 *  scripted headlessly. */
export async function arbitrate(
  jobId: number,
  workerBps: number,
  slashBps: number,
): Promise<{ txHash: string }> {
  const rpc = process.env.ARC_TESTNET_RPC!;
  const { stdout } = await execFileAsync('cast', [
    'send',
    ESCROW_ADDRESS,
    'arbitrate(uint256,uint256,uint256)',
    String(jobId),
    String(workerBps),
    String(slashBps),
    '--private-key',
    ARBITER_PRIVATE_KEY,
    '--rpc-url',
    rpc,
    '--json',
  ]);
  const parsed = JSON.parse(stdout);
  return { txHash: parsed.transactionHash };
}

export { ARBITER_ADDRESS };

/** keccak256 of arbitrary text, matching Solidity's `keccak256(bytes)` —
 *  shells out to Foundry's `cast keccak` rather than pulling in a JS keccak
 *  implementation, reusing the toolchain already vendored in Part 1/2. */
export async function keccak256Of(text: string): Promise<`0x${string}`> {
  const { stdout } = await execFileAsync('cast', ['keccak', text]);
  return stdout.trim() as `0x${string}`;
}

// ── Milestone escrow — nanopayments: pay-per-verified-chunk ─────────────

function toWei(usdc: string): string {
  return BigInt(Math.round(Number(usdc) * 1e18)).toString();
}

export async function milestoneNextJobId(): Promise<number> {
  const result = await query(MILESTONE_ESCROW_ADDRESS, 'nextJobId()(uint256)');
  return Number(parseCastUint(result));
}

/** Creates a 3-milestone job via the CLI-compatible scalar overload — see
 *  MilestoneEscrow.createJob3 for why: Circle CLI's `wallet execute` ABI
 *  encoder does not support array parameters (confirmed by testing; the
 *  identical call works fine via `cast`), so the flexible N-milestone
 *  `createJob(..., uint96[])` is reserved for non-agent/cast-driven use. */
export async function createMilestoneJob3(
  buyerWallet: `0x${string}`,
  worker: `0x${string}`,
  verifier: `0x${string}`,
  specHash: `0x${string}`,
  passScore: number,
  deadline: number,
  disputeWindowSeconds: number,
  minWorkerStakeUsdc: string,
  milestoneAmountsUsdc: [string, string, string],
): Promise<{ jobId: number; tx: { txHash?: string; txId?: string } }> {
  const jobId = await milestoneNextJobId();
  const minStakeWei = toWei(minWorkerStakeUsdc);
  const m0 = toWei(milestoneAmountsUsdc[0]);
  const m1 = toWei(milestoneAmountsUsdc[1]);
  const m2 = toWei(milestoneAmountsUsdc[2]);
  const total = milestoneAmountsUsdc.reduce((s, a) => s + Number(a), 0);
  const tx = await execute(
    buyerWallet,
    MILESTONE_ESCROW_ADDRESS,
    'createJob3(address,address,bytes32,uint8,uint64,uint32,uint96,uint96,uint96,uint96)',
    [worker, verifier, specHash, passScore, deadline, disputeWindowSeconds, minStakeWei, m0, m1, m2],
    total.toString(),
  );
  return { jobId, tx };
}

export async function deliverMilestone(
  workerWallet: `0x${string}`,
  jobId: number,
  milestoneIndex: number,
  deliverableHash: `0x${string}`,
) {
  return execute(workerWallet, MILESTONE_ESCROW_ADDRESS, 'deliver(uint256,uint256,bytes32)', [
    jobId,
    milestoneIndex,
    deliverableHash,
  ]);
}

export async function submitMilestoneVerdict(
  verifierWallet: `0x${string}`,
  jobId: number,
  milestoneIndex: number,
  score: number,
  verdictHash: `0x${string}`,
) {
  return execute(verifierWallet, MILESTONE_ESCROW_ADDRESS, 'submitVerdict(uint256,uint256,uint8,bytes32)', [
    jobId,
    milestoneIndex,
    score,
    verdictHash,
  ]);
}

export async function settleMilestone(callerWallet: `0x${string}`, jobId: number, milestoneIndex: number) {
  return execute(callerWallet, MILESTONE_ESCROW_ADDRESS, 'settle(uint256,uint256)', [jobId, milestoneIndex]);
}

export async function disputeMilestone(
  callerWallet: `0x${string}`,
  jobId: number,
  milestoneIndex: number,
) {
  return execute(callerWallet, MILESTONE_ESCROW_ADDRESS, 'dispute(uint256,uint256)', [jobId, milestoneIndex]);
}

export async function getMilestoneStatus(jobId: number, milestoneIndex: number): Promise<number> {
  const result = await query(
    MILESTONE_ESCROW_ADDRESS,
    'getMilestone(uint256,uint256)((uint96,bytes32,bytes32,uint64,uint8,uint8))',
    [jobId, milestoneIndex],
  );
  const fields = result.replace(/^\(|\)$/g, '').split(', ');
  return Number(fields[5]);
}

/// Arbitration on a milestone stays on the raw arbiter key, same rationale
/// as ClearPactEscrow.arbitrate.
export async function arbitrateMilestone(
  jobId: number,
  milestoneIndex: number,
  workerBps: number,
  slashBps: number,
): Promise<{ txHash: string }> {
  const rpc = process.env.ARC_TESTNET_RPC!;
  const { stdout } = await execFileAsync('cast', [
    'send',
    MILESTONE_ESCROW_ADDRESS,
    'arbitrate(uint256,uint256,uint256,uint256)',
    String(jobId),
    String(milestoneIndex),
    String(workerBps),
    String(slashBps),
    '--private-key',
    ARBITER_PRIVATE_KEY,
    '--rpc-url',
    rpc,
    '--json',
  ]);
  const parsed = JSON.parse(stdout);
  return { txHash: parsed.transactionHash };
}

// ── Gas/gap sponsorship — Arc's answer to "Paymaster" ────────────────────
//
// Circle's own Paymaster product (pay gas in USDC via ERC-4337) runs only on
// Base/Arbitrum/Avalanche/Ethereum/Optimism/Polygon/Unichain — not Arc, per
// developers.circle.com/paymaster (checked live). Arc has native ERC-4337
// account-abstraction support, but only via bring-your-own third-party
// bundler/paymaster (Pimlico, Biconomy, ZeroDev) — a new external account and
// integration surface with no time left to safely vet before the deadline.
//
// Arc's actual answer is structural, not a bolt-on: gas *is* USDC, natively,
// so there is no separate volatile gas token to sponsor away in the first
// place — every tx this whole protocol has ever sent already paid gas in the
// same currency it settles jobs in. The remaining real problem a paymaster
// solves for agents — "a brand new agent needs *some* funds before it can
// afford its first transaction" — is solved directly here: a buyer (or the
// protocol) can sponsor a newcomer worker with a small starter grant, a
// plain native transfer, so it can afford to stake a bond and deliver its
// first job.
export async function sponsorWorker(
  sponsorWallet: `0x${string}`,
  workerAddress: `0x${string}`,
  amountUsdc: string,
): Promise<{ txHash?: string; txId?: string }> {
  const bin = await resolveCircleBin();
  const { stdout } = await execFileAsync(bin, [
    'wallet',
    'transfer',
    workerAddress,
    '--amount',
    amountUsdc,
    '--address',
    sponsorWallet,
    '--chain',
    CHAIN,
    '--output',
    'json',
  ]);
  const parsed = JSON.parse(stdout);
  const data = parsed.data ?? parsed;
  return { txHash: data?.transactionHash ?? data?.txHash, txId: data?.transactionId ?? data?.txId };
}

// ── Circle Gateway — the Nanopayments settlement rail ────────────────────
//
// Gateway is the batched, gas-free settlement layer Circle Nanopayments is
// built on. `direct` deposits are confirmed live on ARC-TESTNET (checked via
// `circle gateway deposit --help`, which lists ARC-TESTNET among the
// `direct`-method source chains). A worker depositing its ClearPact earnings
// into Gateway is the real, provable "our agents use Circle Nanopayments"
// story: the same batched-settlement rail Circle's x402 marketplace uses is
// available to route milestone payouts through, not just claimed.
export async function gatewayDeposit(
  wallet: `0x${string}`,
  amountUsdc: string,
): Promise<{ raw: any }> {
  const raw = await circleJson([
    'gateway',
    'deposit',
    '--amount',
    amountUsdc,
    '--address',
    wallet,
    '--chain',
    CHAIN,
    '--method',
    'direct',
  ]);
  return { raw };
}

export async function gatewayBalance(wallet: `0x${string}`): Promise<any> {
  return circleJson(['gateway', 'balance', '--address', wallet, '--chain', CHAIN]);
}

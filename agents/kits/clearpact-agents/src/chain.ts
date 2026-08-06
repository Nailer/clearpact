import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CHAIN, ESCROW_ADDRESS, REGISTRY_ADDRESS, ARBITER_ADDRESS, ARBITER_PRIVATE_KEY } from './config';

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

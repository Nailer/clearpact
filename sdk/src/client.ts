import {
  type WalletClient,
  type PublicClient,
  type Account,
  type Chain,
  type Abi,
  createPublicClient,
  http,
  keccak256,
  stringToHex,
  parseEther,
  decodeEventLog,
} from "viem";
import { DEFAULT_ADDRESSES } from "./config.js";
import { ClearPactEscrowAbi } from "./abi/ClearPactEscrow.js";
import { MilestoneEscrowAbi } from "./abi/MilestoneEscrow.js";
import { ReputationRegistryAbi } from "./abi/ReputationRegistry.js";
import {
  type Address,
  type Hash,
  type TxResult,
  type EscrowPaymentParams,
  type Job,
  type MilestonePaymentParams,
  type Milestone,
  type AgentReputation,
  JobStatus,
} from "./types.js";

export type ClearPactClientOptions = {
  /** A viem WalletClient with an account attached — from a raw private key,
   *  a Circle adapter, or a connected browser wallet. Any signer works. */
  walletClient: WalletClient<any, Chain, Account>;
  /** Optional: reuse an existing PublicClient. Defaults to one built from
   *  the wallet client's chain via its default RPC. */
  publicClient?: PublicClient;
  /** Optional: point at a different deployment (e.g. a fork, or a future
   *  Arc mainnet deployment). Defaults to the live Arc testnet addresses. */
  addresses?: Partial<typeof DEFAULT_ADDRESSES>;
};

function hashText(text: string): Hash {
  return keccak256(stringToHex(text));
}

function toWei(amountUsdc: string): bigint {
  return parseEther(amountUsdc); // USDC is 18 decimals on Arc, same as ETH elsewhere
}

/**
 * ClearPact SDK — escrow, verification, and reputation for agent-to-agent
 * USDC payments on Arc, in one call. Wraps the live ClearPactEscrow,
 * MilestoneEscrow, and ReputationRegistry contracts.
 *
 * Every write method here waits for on-chain confirmation before resolving
 * — not just for the tx hash to be handed back by the node. A job's
 * lifecycle is inherently sequential (you can't `deliver()` before
 * `escrowPayment()` is actually mined), and viem's raw `writeContract`
 * resolves as soon as a transaction is *broadcast*, not once it lands. If
 * this client didn't wait, any caller who awaits one call and immediately
 * fires the next would hit sporadic, hard-to-debug "wrong status" reverts
 * depending on network timing — worse, it would work in local testing and
 * fail in the field. It costs one extra round-trip per call; a payments SDK
 * should default to correct, not fast.
 *
 * @example
 * ```ts
 * const clearpact = createClearPactClient({ walletClient });
 * const { jobId } = await clearpact.escrowPayment({
 *   worker: "0x...", verifier: "0x...",
 *   description: "Summarize this dataset in 3 sentences.",
 *   amount: "0.5",
 * });
 * ```
 */
export class ClearPactClient {
  private readonly wallet: WalletClient<any, Chain, Account>;
  private readonly publicClient: PublicClient;
  private readonly addresses: typeof DEFAULT_ADDRESSES;

  constructor(opts: ClearPactClientOptions) {
    this.wallet = opts.walletClient;
    this.publicClient =
      opts.publicClient ??
      (createPublicClient({ chain: opts.walletClient.chain, transport: http() }) as PublicClient);
    this.addresses = { ...DEFAULT_ADDRESSES, ...opts.addresses };
  }

  /** Write + wait for confirmation. Returns the hash and decoded logs. */
  private async writeAndConfirm(request: Record<string, unknown>): Promise<{ txHash: Hash; logs: readonly unknown[] }> {
    const txHash = (await this.wallet.writeContract({
      ...request,
      chain: this.wallet.chain,
      account: this.wallet.account,
    } as never)) as Hash;
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") throw new Error(`Transaction ${txHash} reverted`);
    return { txHash, logs: receipt.logs };
  }

  private decodeJobId(logs: readonly unknown[], abi: Abi): number {
    for (const log of logs as any[]) {
      try {
        const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
        if (decoded.eventName === "JobCreated") {
          return Number((decoded.args as unknown as { jobId: bigint }).jobId);
        }
      } catch {
        // Not a JobCreated log (e.g. the native-USDC transfer log) — skip.
      }
    }
    throw new Error("JobCreated event not found in transaction receipt");
  }

  // ─────────────────────────── Single-payment jobs ────────────────────────

  /** Escrow a single-payment job. The headline "one call" primitive. Waits
   *  for confirmation and reads the real jobId back from the JobCreated
   *  event, rather than guessing it from a pre-read nextJobId (which races
   *  against any other pending job creation). */
  async escrowPayment(params: EscrowPaymentParams): Promise<{ jobId: number; txHash: Hash }> {
    const specHash = hashText(params.description);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + (params.deadlineMinutes ?? 60) * 60);

    const { txHash, logs } = await this.writeAndConfirm({
      address: this.addresses.escrow,
      abi: ClearPactEscrowAbi,
      functionName: "createJob",
      args: [
        params.worker,
        params.verifier,
        specHash,
        params.passScore ?? 70,
        deadline,
        params.disputeWindowSeconds ?? 300,
        toWei(params.minWorkerStake ?? "0"),
      ],
      value: toWei(params.amount),
    });

    return { jobId: this.decodeJobId(logs, ClearPactEscrowAbi as unknown as Abi), txHash };
  }

  /** Worker: submit the deliverable for a single-payment job. */
  async deliver(args: { jobId: number; deliverable: string }): Promise<TxResult & { deliverableHash: Hash }> {
    const deliverableHash = hashText(args.deliverable);
    const { txHash } = await this.writeAndConfirm({
      address: this.addresses.escrow,
      abi: ClearPactEscrowAbi,
      functionName: "deliver",
      args: [BigInt(args.jobId), deliverableHash],
    });
    return { txHash, deliverableHash };
  }

  /** Verifier: grade the delivery. This is the sole settlement trigger. */
  async submitVerdict(args: { jobId: number; score: number; rationale: string }): Promise<TxResult & { verdictHash: Hash }> {
    const verdictHash = hashText(args.rationale);
    const { txHash } = await this.writeAndConfirm({
      address: this.addresses.escrow,
      abi: ClearPactEscrowAbi,
      functionName: "submitVerdict",
      args: [BigInt(args.jobId), args.score, verdictHash],
    });
    return { txHash, verdictHash };
  }

  /** Anyone: settle a job once its dispute window has closed. Permissionless. */
  async settle(args: { jobId: number }): Promise<TxResult> {
    const { txHash } = await this.writeAndConfirm({
      address: this.addresses.escrow,
      abi: ClearPactEscrowAbi,
      functionName: "settle",
      args: [BigInt(args.jobId)],
    });
    return { txHash };
  }

  /** Buyer: accept the delivery directly, skipping verification. */
  async acceptDelivery(args: { jobId: number }): Promise<TxResult> {
    const { txHash } = await this.writeAndConfirm({
      address: this.addresses.escrow,
      abi: ClearPactEscrowAbi,
      functionName: "acceptDelivery",
      args: [BigInt(args.jobId)],
    });
    return { txHash };
  }

  /** Buyer or worker: escalate a verdict inside the dispute window. */
  async dispute(args: { jobId: number }): Promise<TxResult> {
    const { txHash } = await this.writeAndConfirm({
      address: this.addresses.escrow,
      abi: ClearPactEscrowAbi,
      functionName: "dispute",
      args: [BigInt(args.jobId)],
    });
    return { txHash };
  }

  /** Arbiter only: split a disputed job and optionally slash the worker's bond. */
  async arbitrate(args: { jobId: number; workerBps: number; slashBps: number }): Promise<TxResult> {
    const { txHash } = await this.writeAndConfirm({
      address: this.addresses.escrow,
      abi: ClearPactEscrowAbi,
      functionName: "arbitrate",
      args: [BigInt(args.jobId), BigInt(args.workerBps), BigInt(args.slashBps)],
    });
    return { txHash };
  }

  async getJob(jobId: number): Promise<Job> {
    const j = (await this.publicClient.readContract({
      address: this.addresses.escrow,
      abi: ClearPactEscrowAbi,
      functionName: "getJob",
      args: [BigInt(jobId)],
    })) as any;
    return {
      buyer: j.buyer,
      worker: j.worker,
      verifier: j.verifier,
      amount: j.amount,
      deadline: j.deadline,
      disputeWindow: j.disputeWindow,
      verdictAt: j.verdictAt,
      score: j.score,
      passScore: j.passScore,
      status: j.status as JobStatus,
      minWorkerStake: j.minWorkerStake,
    };
  }

  // ─────────────────────── Milestone (streaming) jobs ──────────────────────

  /** Escrow a 3-milestone job — the worker is paid for each verified chunk
   *  independently, instead of waiting for the whole job to finish. */
  async escrowMilestonePayment(params: MilestonePaymentParams): Promise<{ jobId: number; txHash: Hash }> {
    const specHash = hashText(params.description);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + (params.deadlineMinutes ?? 60) * 60);
    const amounts = params.milestoneAmounts.map(toWei) as [bigint, bigint, bigint];
    const value = amounts[0] + amounts[1] + amounts[2];

    const { txHash, logs } = await this.writeAndConfirm({
      address: this.addresses.milestoneEscrow,
      abi: MilestoneEscrowAbi,
      functionName: "createJob3",
      args: [
        params.worker,
        params.verifier,
        specHash,
        params.passScore ?? 70,
        deadline,
        params.disputeWindowSeconds ?? 300,
        toWei(params.minWorkerStake ?? "0"),
        amounts[0],
        amounts[1],
        amounts[2],
      ],
      value,
    });

    return { jobId: this.decodeJobId(logs, MilestoneEscrowAbi as unknown as Abi), txHash };
  }

  async deliverMilestone(args: { jobId: number; milestoneIndex: number; deliverable: string }): Promise<TxResult & { deliverableHash: Hash }> {
    const deliverableHash = hashText(args.deliverable);
    const { txHash } = await this.writeAndConfirm({
      address: this.addresses.milestoneEscrow,
      abi: MilestoneEscrowAbi,
      functionName: "deliver",
      args: [BigInt(args.jobId), BigInt(args.milestoneIndex), deliverableHash],
    });
    return { txHash, deliverableHash };
  }

  async submitMilestoneVerdict(args: {
    jobId: number;
    milestoneIndex: number;
    score: number;
    rationale: string;
  }): Promise<TxResult & { verdictHash: Hash }> {
    const verdictHash = hashText(args.rationale);
    const { txHash } = await this.writeAndConfirm({
      address: this.addresses.milestoneEscrow,
      abi: MilestoneEscrowAbi,
      functionName: "submitVerdict",
      args: [BigInt(args.jobId), BigInt(args.milestoneIndex), args.score, verdictHash],
    });
    return { txHash, verdictHash };
  }

  async settleMilestone(args: { jobId: number; milestoneIndex: number }): Promise<TxResult> {
    const { txHash } = await this.writeAndConfirm({
      address: this.addresses.milestoneEscrow,
      abi: MilestoneEscrowAbi,
      functionName: "settle",
      args: [BigInt(args.jobId), BigInt(args.milestoneIndex)],
    });
    return { txHash };
  }

  async disputeMilestone(args: { jobId: number; milestoneIndex: number }): Promise<TxResult> {
    const { txHash } = await this.writeAndConfirm({
      address: this.addresses.milestoneEscrow,
      abi: MilestoneEscrowAbi,
      functionName: "dispute",
      args: [BigInt(args.jobId), BigInt(args.milestoneIndex)],
    });
    return { txHash };
  }

  /** Arbiter only. */
  async arbitrateMilestone(args: {
    jobId: number;
    milestoneIndex: number;
    workerBps: number;
    slashBps: number;
  }): Promise<TxResult> {
    const { txHash } = await this.writeAndConfirm({
      address: this.addresses.milestoneEscrow,
      abi: MilestoneEscrowAbi,
      functionName: "arbitrate",
      args: [BigInt(args.jobId), BigInt(args.milestoneIndex), BigInt(args.workerBps), BigInt(args.slashBps)],
    });
    return { txHash };
  }

  async getMilestones(jobId: number): Promise<Milestone[]> {
    const count = Number(
      await this.publicClient.readContract({
        address: this.addresses.milestoneEscrow,
        abi: MilestoneEscrowAbi,
        functionName: "milestoneCount",
        args: [BigInt(jobId)],
      }),
    );
    const milestones: Milestone[] = [];
    for (let i = 0; i < count; i++) {
      const m = (await this.publicClient.readContract({
        address: this.addresses.milestoneEscrow,
        abi: MilestoneEscrowAbi,
        functionName: "getMilestone",
        args: [BigInt(jobId), BigInt(i)],
      })) as any;
      milestones.push({ amount: m.amount, score: m.score, status: m.status as JobStatus });
    }
    return milestones;
  }

  // ────────────────────────────── Reputation ────────────────────────────

  /** Post a native-USDC bond. Required before delivering on a bonded job. */
  async stakeBond(amountUsdc: string): Promise<TxResult> {
    const { txHash } = await this.writeAndConfirm({
      address: this.addresses.registry,
      abi: ReputationRegistryAbi,
      functionName: "stake",
      args: [],
      value: toWei(amountUsdc),
    });
    return { txHash };
  }

  /** Withdraw free (unlocked) bond. */
  async unstakeBond(amountUsdc: string): Promise<TxResult> {
    const { txHash } = await this.writeAndConfirm({
      address: this.addresses.registry,
      abi: ReputationRegistryAbi,
      functionName: "unstake",
      args: [toWei(amountUsdc)],
    });
    return { txHash };
  }

  /** Read an agent's on-chain credit score and track record — free for
   *  anyone to check before hiring a worker. */
  async getReputation(address: Address): Promise<AgentReputation> {
    const [score, freeStake, lockedStake, stats] = await Promise.all([
      this.publicClient.readContract({
        address: this.addresses.registry,
        abi: ReputationRegistryAbi,
        functionName: "reputationScore",
        args: [address],
      }),
      this.publicClient.readContract({
        address: this.addresses.registry,
        abi: ReputationRegistryAbi,
        functionName: "freeStakeOf",
        args: [address],
      }),
      this.publicClient.readContract({
        address: this.addresses.registry,
        abi: ReputationRegistryAbi,
        functionName: "lockedStakeOf",
        args: [address],
      }),
      this.publicClient.readContract({
        address: this.addresses.registry,
        abi: ReputationRegistryAbi,
        functionName: "statsOf",
        args: [address],
      }),
    ]);
    const s = stats as unknown as [bigint, bigint, bigint, bigint, bigint];
    return {
      address,
      score: Number(score),
      freeStake: freeStake as bigint,
      lockedStake: lockedStake as bigint,
      jobsDelivered: Number(s[0]),
      jobsPassed: Number(s[1]),
      disputesLost: Number(s[2]),
      totalEarned: s[3],
    };
  }
}

export function createClearPactClient(opts: ClearPactClientOptions): ClearPactClient {
  return new ClearPactClient(opts);
}

import { publicClient } from "./viemClient";
import { CONTRACTS } from "./config";
import { ClearPactEscrowAbi } from "./abi/ClearPactEscrow";
import { ReputationRegistryAbi } from "./abi/ReputationRegistry";
import { MilestoneEscrowAbi } from "./abi/MilestoneEscrow";

export const STATUS_LABELS = [
  "None",
  "Created",
  "Delivered",
  "Verified",
  "Disputed",
  "Released",
  "Refunded",
  "Resolved",
] as const;

// A conservative floor below any of our own deployments, so log scans never
// miss real activity but also never crawl from Arc's genesis block.
const FROM_BLOCK = 55_600_000n;

export type FlatJob = {
  kind: "flat";
  jobId: number;
  buyer: `0x${string}`;
  worker: `0x${string}`;
  verifier: `0x${string}`;
  amount: bigint;
  deadline: bigint;
  disputeWindow: number;
  verdictAt: bigint;
  score: number;
  passScore: number;
  status: number;
  minWorkerStake: bigint;
};

export type MilestoneItem = {
  index: number;
  amount: bigint;
  score: number;
  status: number;
};

export type MilestoneJob = {
  kind: "milestone";
  jobId: number;
  buyer: `0x${string}`;
  worker: `0x${string}`;
  verifier: `0x${string}`;
  passScore: number;
  deadline: bigint;
  disputeWindow: number;
  minWorkerStake: bigint;
  milestones: MilestoneItem[];
};

export async function fetchFlatJobs(): Promise<FlatJob[]> {
  const count = await publicClient.readContract({
    address: CONTRACTS.escrow,
    abi: ClearPactEscrowAbi,
    functionName: "nextJobId",
  });
  const ids = Array.from({ length: Number(count) }, (_, i) => i);
  if (ids.length === 0) return [];

  const results = await publicClient.multicall({
    contracts: ids.map((id) => ({
      address: CONTRACTS.escrow,
      abi: ClearPactEscrowAbi,
      functionName: "getJob" as const,
      args: [BigInt(id)] as const,
    })),
  });

  return results
    .map((r, i) => {
      const j = r.result as unknown as
        | {
            buyer: `0x${string}`;
            worker: `0x${string}`;
            verifier: `0x${string}`;
            amount: bigint;
            deadline: bigint;
            disputeWindow: number;
            verdictAt: bigint;
            score: number;
            passScore: number;
            status: number;
            minWorkerStake: bigint;
          }
        | undefined;
      if (!j) return null;
      return {
        kind: "flat" as const,
        jobId: ids[i],
        buyer: j.buyer,
        worker: j.worker,
        verifier: j.verifier,
        amount: j.amount,
        deadline: j.deadline,
        disputeWindow: j.disputeWindow,
        verdictAt: j.verdictAt,
        score: j.score,
        passScore: j.passScore,
        status: j.status,
        minWorkerStake: j.minWorkerStake,
      };
    })
    .filter((x): x is FlatJob => x !== null);
}

export async function fetchMilestoneJobs(): Promise<MilestoneJob[]> {
  const count = await publicClient.readContract({
    address: CONTRACTS.milestoneEscrow,
    abi: MilestoneEscrowAbi,
    functionName: "nextJobId",
  });
  const ids = Array.from({ length: Number(count) }, (_, i) => i);
  if (ids.length === 0) return [];

  const jobResults = await publicClient.multicall({
    contracts: ids.map((id) => ({
      address: CONTRACTS.milestoneEscrow,
      abi: MilestoneEscrowAbi,
      functionName: "jobs" as const,
      args: [BigInt(id)] as const,
    })),
  });

  const countResults = await publicClient.multicall({
    contracts: ids.map((id) => ({
      address: CONTRACTS.milestoneEscrow,
      abi: MilestoneEscrowAbi,
      functionName: "milestoneCount" as const,
      args: [BigInt(id)] as const,
    })),
  });

  const milestoneCalls: { jobId: number; index: number }[] = [];
  countResults.forEach((r, i) => {
    const n = Number(r.result ?? 0n);
    for (let m = 0; m < n; m++) milestoneCalls.push({ jobId: ids[i], index: m });
  });

  const milestoneResults = await publicClient.multicall({
    contracts: milestoneCalls.map((c) => ({
      address: CONTRACTS.milestoneEscrow,
      abi: MilestoneEscrowAbi,
      functionName: "getMilestone" as const,
      args: [BigInt(c.jobId), BigInt(c.index)] as const,
    })),
  });

  const milestonesByJob = new Map<number, MilestoneItem[]>();
  milestoneCalls.forEach((c, i) => {
    const m = milestoneResults[i].result as unknown as { amount: bigint; score: number; status: number };
    const list = milestonesByJob.get(c.jobId) ?? [];
    list.push({ index: c.index, amount: m.amount, score: m.score, status: m.status });
    milestonesByJob.set(c.jobId, list);
  });

  return jobResults
    .map((r, i) => {
      // `jobs(uint256)` is an auto-generated public-mapping getter with
      // multiple top-level outputs (unlike a function returning one
      // struct-typed tuple) — viem decodes these positionally as an array,
      // not as a named object.
      const j = r.result as unknown as
        | readonly [
            `0x${string}`, // buyer
            `0x${string}`, // worker
            `0x${string}`, // verifier
            bigint, // minWorkerStake
            bigint, // lockedStake
            bigint, // deadline
            number, // disputeWindow
            number, // passScore
            number, // milestonesResolved
            boolean, // bondSettled
          ]
        | undefined;
      if (!j || j[0] === "0x0000000000000000000000000000000000000000") return null;
      const [buyer, worker, verifier, minWorkerStake, , deadline, disputeWindow, passScore] = j;
      return {
        kind: "milestone" as const,
        jobId: ids[i],
        buyer,
        worker,
        verifier,
        passScore,
        deadline,
        disputeWindow,
        minWorkerStake,
        milestones: milestonesByJob.get(ids[i]) ?? [],
      };
    })
    .filter((x): x is MilestoneJob => x !== null);
}

export type AgentStats = {
  address: `0x${string}`;
  reputationScore: number;
  freeStake: bigint;
  lockedStake: bigint;
  jobsDelivered: number;
  jobsPassed: number;
  disputesLost: number;
  totalEarned: bigint;
};

/** No enumerable agent list on-chain — derive the set of addresses that have
 *  ever acted as a worker from job/milestone event logs, then read each
 *  one's current registry stats live. */
export async function fetchAgents(flatJobs: FlatJob[], milestoneJobs: MilestoneJob[]): Promise<AgentStats[]> {
  const workers = new Set<`0x${string}`>();
  for (const j of flatJobs) if (j.worker) workers.add(j.worker);
  for (const j of milestoneJobs) if (j.worker) workers.add(j.worker);
  const list = Array.from(workers).filter(Boolean);
  if (list.length === 0) return [];

  const [scores, freeStakes, lockedStakes, stats] = await Promise.all([
    publicClient.multicall({
      contracts: list.map((a) => ({
        address: CONTRACTS.registry,
        abi: ReputationRegistryAbi,
        functionName: "reputationScore" as const,
        args: [a] as const,
      })),
    }),
    publicClient.multicall({
      contracts: list.map((a) => ({
        address: CONTRACTS.registry,
        abi: ReputationRegistryAbi,
        functionName: "freeStakeOf" as const,
        args: [a] as const,
      })),
    }),
    publicClient.multicall({
      contracts: list.map((a) => ({
        address: CONTRACTS.registry,
        abi: ReputationRegistryAbi,
        functionName: "lockedStakeOf" as const,
        args: [a] as const,
      })),
    }),
    publicClient.multicall({
      contracts: list.map((a) => ({
        address: CONTRACTS.registry,
        abi: ReputationRegistryAbi,
        functionName: "statsOf" as const,
        args: [a] as const,
      })),
    }),
  ]);

  return list.map((address, i) => {
    const s = stats[i].result as unknown as
      | [bigint, bigint, bigint, bigint, bigint]
      | { jobsDelivered: bigint; jobsPassed: bigint; disputesLost: bigint; totalEarned: bigint; scoreSum: bigint }
      | undefined;
    const arr = !s ? [0n, 0n, 0n, 0n, 0n] : Array.isArray(s) ? s : [s.jobsDelivered, s.jobsPassed, s.disputesLost, s.totalEarned, s.scoreSum];
    return {
      address,
      reputationScore: Number(scores[i].result ?? 50n),
      freeStake: (freeStakes[i].result as bigint) ?? 0n,
      lockedStake: (lockedStakes[i].result as bigint) ?? 0n,
      jobsDelivered: Number(arr[0]),
      jobsPassed: Number(arr[1]),
      disputesLost: Number(arr[2]),
      totalEarned: arr[3] as bigint,
    };
  });
}

export type ActivityEvent = {
  contract: "escrow" | "milestone" | "registry";
  eventName: string;
  blockNumber: bigint;
  txHash: `0x${string}`;
  args: Record<string, unknown>;
};

// Public Arc testnet RPC providers cap eth_getLogs to a few thousand blocks
// per call (dRPC's free tier: 10,000) — chunk the scan range rather than
// requesting it in one call.
const LOG_CHUNK_BLOCKS = 9_000n;

async function getLogsChunked(address: `0x${string}`, fromBlock: bigint) {
  const latest = await publicClient.getBlockNumber();
  const ranges: { fromBlock: bigint; toBlock: bigint }[] = [];
  for (let start = fromBlock; start <= latest; start += LOG_CHUNK_BLOCKS) {
    const end = start + LOG_CHUNK_BLOCKS - 1n > latest ? latest : start + LOG_CHUNK_BLOCKS - 1n;
    ranges.push({ fromBlock: start, toBlock: end });
  }
  const results = await Promise.all(
    ranges.map((r) => publicClient.getLogs({ address, fromBlock: r.fromBlock, toBlock: r.toBlock })),
  );
  return results.flat();
}

async function eventsFor(
  address: `0x${string}`,
  abi: readonly unknown[],
  contract: ActivityEvent["contract"],
): Promise<ActivityEvent[]> {
  const logs = await getLogsChunked(address, FROM_BLOCK);
  const { decodeEventLog } = await import("viem");
  const out: ActivityEvent[] = [];
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({ abi: abi as never, data: log.data, topics: log.topics });
      out.push({
        contract,
        eventName: decoded.eventName as unknown as string,
        blockNumber: log.blockNumber ?? 0n,
        txHash: log.transactionHash ?? "0x",
        args: decoded.args as unknown as Record<string, unknown>,
      });
    } catch {
      // Non-matching log (shouldn't happen when filtering by address+abi, but stay defensive).
    }
  }
  return out;
}

export async function fetchActivity(): Promise<ActivityEvent[]> {
  const [escrowEvents, milestoneEvents, registryEvents] = await Promise.all([
    eventsFor(CONTRACTS.escrow, ClearPactEscrowAbi, "escrow"),
    eventsFor(CONTRACTS.milestoneEscrow, MilestoneEscrowAbi, "milestone"),
    eventsFor(CONTRACTS.registry, ReputationRegistryAbi, "registry"),
  ]);
  return [...escrowEvents, ...milestoneEvents, ...registryEvents].sort((a, b) =>
    a.blockNumber === b.blockNumber ? 0 : a.blockNumber > b.blockNumber ? -1 : 1,
  );
}

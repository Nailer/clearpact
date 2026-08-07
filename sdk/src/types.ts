export type Address = `0x${string}`;
export type Hash = `0x${string}`;

/** Mirrors ClearPactEscrow.Status / MilestoneEscrow.Status. */
export enum JobStatus {
  None = 0,
  Created = 1,
  Delivered = 2,
  Verified = 3,
  Disputed = 4,
  Released = 5,
  Refunded = 6,
  Resolved = 7,
}

export type TxResult = { txHash: Hash };

export type EscrowPaymentParams = {
  worker: Address;
  verifier: Address;
  /** Full job spec / acceptance criteria, in plain text. Hashed on-chain as the commitment — both sides can be held to it later. */
  description: string;
  /** USDC amount to escrow, human units, e.g. "0.5". */
  amount: string;
  /** Minimum verifier score (0-100) that counts as acceptance. Defaults to 70. */
  passScore?: number;
  /** Worker must deliver within this many minutes. Defaults to 60. */
  deadlineMinutes?: number;
  /** Seconds after a verdict during which either side may dispute. Defaults to 300 (5 min). */
  disputeWindowSeconds?: number;
  /** USDC bond the worker must have staked to accept this job. Defaults to "0" (no bond required). */
  minWorkerStake?: string;
};

export type Job = {
  buyer: Address;
  worker: Address;
  verifier: Address;
  amount: bigint;
  deadline: bigint;
  disputeWindow: number;
  verdictAt: bigint;
  score: number;
  passScore: number;
  status: JobStatus;
  minWorkerStake: bigint;
};

export type MilestonePaymentParams = {
  worker: Address;
  verifier: Address;
  description: string;
  /** Exactly 3 USDC amounts, one per milestone, human units. */
  milestoneAmounts: [string, string, string];
  passScore?: number;
  deadlineMinutes?: number;
  disputeWindowSeconds?: number;
  minWorkerStake?: string;
};

export type Milestone = {
  amount: bigint;
  score: number;
  status: JobStatus;
};

export type AgentReputation = {
  address: Address;
  /** 0-100. Newcomers (no delivered jobs) start at 50. */
  score: number;
  freeStake: bigint;
  lockedStake: bigint;
  jobsDelivered: number;
  jobsPassed: number;
  disputesLost: number;
  totalEarned: bigint;
};

# @clearpact/sdk

Escrow, verification, and reputation for agent-to-agent USDC payments on Arc — in one call.

If you're building an agent that pays another agent for work, don't wire up your own trust layer.
Drop this in: your agent's payment gets held in escrow until a verifier grades the delivered work,
and only then does it release. No custom contract, no reputation system to build yourself.

Wraps ClearPact's live, tested, deployed Arc testnet contracts — [full write-up and on-chain
evidence in the main repo](../README.md).

## Install

```bash
npm install @clearpact/sdk viem
```

## Quickstart

```ts
import { createClearPactClient, arcTestnet } from "@clearpact/sdk";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const walletClient = createWalletClient({
  account: privateKeyToAccount("0x..."),
  chain: arcTestnet,
  transport: http(),
});

const clearpact = createClearPactClient({ walletClient });

// Escrow a payment for a job — the one-liner.
const { jobId } = await clearpact.escrowPayment({
  worker: "0x...",
  verifier: "0x...",
  description: "Summarize this dataset in 3 sentences.",
  amount: "0.5", // USDC
});

// Worker side, once the job is done:
await clearpact.deliver({ jobId, deliverable: "The dataset shows..." });

// Verifier side — this is the sole settlement trigger:
await clearpact.submitVerdict({ jobId, score: 95, rationale: "Meets all criteria." });

// Anyone, once the dispute window closes — permissionless:
await clearpact.settle({ jobId });
```

`walletClient` can come from anywhere with an account attached — a raw private key (above), a
Circle Wallet via `@circle-fin/adapter-viem-v2`, or a connected browser wallet. The SDK doesn't
care how you sign, only that you can.

Every write method **waits for on-chain confirmation** before resolving — not just for the tx to
broadcast. A job's steps are inherently sequential (you can't `deliver()` before `escrowPayment()`
is actually mined), so this SDK won't hand you a `jobId` back until it's real and confirmed.

## Streaming (milestone) payments

For jobs that break into stages, pay per verified chunk instead of one lump sum:

```ts
const { jobId } = await clearpact.escrowMilestonePayment({
  worker: "0x...",
  verifier: "0x...",
  description: "Three-part report.",
  milestoneAmounts: ["0.1", "0.15", "0.1"], // exactly 3
});

await clearpact.deliverMilestone({ jobId, milestoneIndex: 0, deliverable: "Part 1..." });
await clearpact.submitMilestoneVerdict({ jobId, milestoneIndex: 0, score: 90, rationale: "Good." });
await clearpact.settleMilestone({ jobId, milestoneIndex: 0 }); // paid now, not at the end
```

See [`examples/milestone-job.ts`](examples/milestone-job.ts) for the full 3-milestone flow.

## Reputation

Every worker builds a public, on-chain credit score — check it before you hire:

```ts
const rep = await clearpact.getReputation("0x...");
// { score: 97, jobsDelivered: 12, jobsPassed: 11, disputesLost: 0, totalEarned: 4200000000000000000n, ... }
```

Newcomers start at a neutral 50. Score rises with verified work, drops hard on a lost dispute.
Jobs that require a bond (`minWorkerStake`) need the worker to `stakeBond()` first — "no bond, no
work" is enforced on-chain.

## Disputes

If either side disagrees with a verdict, escalate inside the dispute window:

```ts
await clearpact.dispute({ jobId });
// An authorized arbiter then rules:
await clearpact.arbitrate({ jobId, workerBps: 1000, slashBps: 5000 }); // worker gets 10%, half its bond is slashed to the buyer
```

`arbitrate` is restricted to the protocol's arbiter address — most integrators won't call this
directly, but it's exposed for completeness (e.g. running your own dispute-resolution service).

## Live deployment (Arc testnet, chain 5042002)

| Contract | Address |
|---|---|
| ClearPactEscrow | `0xDbd9976d55987c956DBfEcad1b98A3Cf00e58b28` |
| MilestoneEscrow | `0x783A0230b5912520B06e49a98BB578975A370391` |
| ReputationRegistry | `0x3c639b6C061F4C14dbac60E0C48010Ef7888B1Ec` |

Point at a different deployment by passing `addresses` to `createClearPactClient`.

## Examples

- [`examples/basic-escrow.ts`](examples/basic-escrow.ts) — full single-payment lifecycle
- [`examples/milestone-job.ts`](examples/milestone-job.ts) — 3-milestone streaming job

## Status

Built for Circle's Build on Arc hackathon. Every method here has been run live against the real
Arc testnet deployment, not just typechecked — see the main repo's
[BUILDLOG](../docs/BUILDLOG.md) for the verification runs. Not yet published to npm (would need an
npm account) — install directly from this repo in the meantime:

```bash
npm install github:Nailer/clearpact#main --workspace=sdk
```

Apache-2.0.

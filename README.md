<img src="assets/logo.svg" alt="ClearPact" width="340">

**The trust & settlement layer for the agent economy — escrow, automated verification, disputes, and credit scores for AI agents, settled in USDC on [Arc](https://www.arc.io/).**

> Built for Circle's **Build on Arc** hackathon (DeFi + Agentic Economy tracks).

## The problem

AI agents are starting to hire and pay other AI agents. Every one of those payments is a leap of faith: pay first and hope the work is good, or work first and hope you get paid. 87% of financial institutions call **trust** the #1 blocker to agentic payments, and there is still no answer to *"who pays when a bot makes a mistaken purchase?"* Production teams hand-roll escrow and reputation systems — nobody has made it a primitive.

## What ClearPact does

Stripe holds money until delivery for humans. ClearPact does it for machines:

1. **Escrow** — a buyer agent locks USDC on Arc with a job spec, acceptance criteria, verifier, deadline, and dispute window.
2. **Verification** — a verifier agent (deterministic checks + LLM judge) grades the delivered work against the criteria and posts a signed verdict on-chain. The verdict *is* the settlement trigger: release, refund, or split — automatically.
3. **Skin in the game** — worker agents stake USDC bonds. Lose a dispute → get slashed. Deliver verified work → build an on-chain reputation score buyers can price against.
4. **Streaming jobs** — long tasks settle per-verified-chunk via Circle Nanopayments instead of one lump escrow.

State machine: `Created → Funded → Delivered → Verified → Released` (or `Disputed → Arbitrated → Split / Refunded / Slashed`).

## Stack

| Layer | Tech |
|-------|------|
| Chain | **Arc testnet** (stablecoin-native L1, USDC gas, sub-second finality) |
| Money | **USDC** end-to-end |
| Contracts | Solidity + Foundry (escrow, staking, reputation) via Circle Contracts |
| Agents | TypeScript, **Circle Agent Stack** starter kit (Claude Agent SDK), **Circle Wallets** |
| Micropayments | **Circle Nanopayments** (x402) + **Paymaster** for sponsored gas |
| Frontend | Next.js dashboard (live, client-side, viem) + **App Kit** (real `kit.send()` sponsorship) |

## Repo layout

```
contracts/   Solidity: ClearPactEscrow, ReputationRegistry, MilestoneEscrow
agents/      buyer, worker & verifier agents — kits/clearpact-agents (Claude Agent SDK, Circle Wallets)
dashboard/   Next.js live view of escrows, milestones, reputation & activity + App Kit
sdk/         @clearpact/sdk — drop-in TypeScript wrapper: escrow any agent-to-agent payment in one call
CLAUDE.md    project source of truth: plan, decisions, session log
```

## SDK — drop this into your own agent project

```ts
import { createClearPactClient } from "@clearpact/sdk";

const clearpact = createClearPactClient({ walletClient }); // any viem WalletClient
const { jobId } = await clearpact.escrowPayment({
  worker: "0x...", verifier: "0x...",
  description: "Summarize this dataset in 3 sentences.",
  amount: "0.5",
});
```

No custom escrow contract, no reputation system to build — see [sdk/README.md](sdk/README.md).
Every method has been run live against the real Arc testnet deployment, not just typechecked.

## Dashboard

An animated landing page at `/`, then `/dashboard` — a live, read-only view of every escrow,
milestone job, and agent reputation, polled directly from Arc testnet in the browser, no backend,
no indexer — plus a real Circle App Kit "sponsor an agent" panel.

```bash
cd dashboard && npm install && npm run dev
```

Open [http://localhost:3000](http://localhost:3000). See [dashboard/README.md](dashboard/README.md).

## Live on Arc testnet

| | |
|---|---|
| **ClearPactEscrow** | [`0xDbd9976d55987c956DBfEcad1b98A3Cf00e58b28`](https://testnet.arcscan.app/address/0xDbd9976d55987c956DBfEcad1b98A3Cf00e58b28) (chain 5042002) |
| **ReputationRegistry** | [`0x3c639b6C061F4C14dbac60E0C48010Ef7888B1Ec`](https://testnet.arcscan.app/address/0x3c639b6C061F4C14dbac60E0C48010Ef7888B1Ec) |
| **MilestoneEscrow** (nanopayments) | [`0x783A0230b5912520B06e49a98BB578975A370391`](https://testnet.arcscan.app/address/0x783A0230b5912520B06e49a98BB578975A370391) |
| Honest work, live | Worker staked a [1 USDC bond](https://testnet.arcscan.app/tx/0xc5fef632b5a49052e9788d2dcb1ff54700b9951a9ce010d2844b776539f7537e), delivered, verified 95/100 → auto-paid; reputation 50 → 97 |
| Fraud caught, live | Junk delivery verified 25/100 → dispute → [arbitration slashed half the bond](https://testnet.arcscan.app/tx/0x641942512222b7a5915d4d90769fb8a96f5c5adaec6c19f49d3d222ed4c5d44d) to the buyer; reputation 97 → 45 |
| **Autonomous agents, live** | Three Claude agents — buyer, worker, verifier — negotiated, delivered, and graded jobs entirely on their own through real Circle Wallets: honest job → [verdict 97](https://testnet.arcscan.app/tx/0x5e4b408ddcad3f6e7c37b4cd2f2faeac7d3fe63884f5b3fc8e1cbc267b97327c) → auto-paid; corner-cutting job → [verdict 3](https://testnet.arcscan.app/tx/0xb6f9433425acad9d62757f40f0bb6795e06b963d9aa9a27d9ab307bcb641a9cc) → disputed → [slashed](https://testnet.arcscan.app/tx/0x4b51dcc38a5e46750763c587b7a7ee88893ab026241c895562840908c1f6f534). Reputation moved 95 → 96 → 54, no scripted scores. |
| **Nanopayments + sponsorship, live** | A brand-new, zero-balance agent wallet was [sponsored 0.8 USDC](https://testnet.arcscan.app/tx/0x6408a748fec983ad541bfd63f84fe098a415955e3b994fa6cd57a776ef77800a) by the buyer, then paid in 3 independent streaming installments as each milestone verified ([m0](https://testnet.arcscan.app/tx/0x81267dc73465ff1bae5208bd98d986b0711429a61864ed7cd1135f221a6ed0df), [m1](https://testnet.arcscan.app/tx/0xf806245683c685fc6d589e41d9a71e4e9a9eae14f57409034a05b0ff6b5d7286), [m2](https://testnet.arcscan.app/tx/0x21fe5c928d6573df86e283740fbbb4ec270a3131211aafb7eb5c6dfab8ca152a)), then [deposited its earnings into Circle Gateway](https://testnet.arcscan.app/tx/0x09ab432c1381f8c88cfa7a6ac0d7caab8f4fb42e2f22c30c80c9b63079983d75). Reputation: 50 → 99, from zero funds to a paid, credentialed agent, no scripted scores. |
| Tests | 48/48 passing (`cd contracts && forge test`) — incl. fuzzed funds-conservation invariants |

More on-chain evidence (every part's tx hashes) in [docs/BUILDLOG.md](docs/BUILDLOG.md).

## Status

🔨 Hackathon build in progress — see [CLAUDE.md](CLAUDE.md) for the live build plan and [docs/BUILDLOG.md](docs/BUILDLOG.md) for the full technical journal.

## Team

AJ (GM) + Claude (PM/engineering).

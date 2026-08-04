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
| Frontend | Next.js dashboard + **App Kits** (Send, Unified Balance) |

## Repo layout (planned)

```
contracts/   Solidity: ClearPactEscrow, StakeRegistry, Reputation
agents/      buyer, worker & verifier agents (Agent Stack)
sdk/         drop-in TypeScript wrapper: escrow any agent-to-agent payment in one call
dashboard/   Next.js live view of escrows, verdicts & reputation
CLAUDE.md    project source of truth: plan, decisions, session log
```

## Live on Arc testnet

| | |
|---|---|
| **ClearPactEscrow** | [`0xDbd9976d55987c956DBfEcad1b98A3Cf00e58b28`](https://testnet.arcscan.app/address/0xDbd9976d55987c956DBfEcad1b98A3Cf00e58b28) (chain 5042002) |
| **ReputationRegistry** | [`0x3c639b6C061F4C14dbac60E0C48010Ef7888B1Ec`](https://testnet.arcscan.app/address/0x3c639b6C061F4C14dbac60E0C48010Ef7888B1Ec) |
| Honest work, live | Worker staked a [1 USDC bond](https://testnet.arcscan.app/tx/0xc5fef632b5a49052e9788d2dcb1ff54700b9951a9ce010d2844b776539f7537e), delivered, verified 95/100 → auto-paid; reputation 50 → 97 |
| Fraud caught, live | Junk delivery verified 25/100 → dispute → [arbitration slashed half the bond](https://testnet.arcscan.app/tx/0x641942512222b7a5915d4d90769fb8a96f5c5adaec6c19f49d3d222ed4c5d44d) to the buyer; reputation 97 → 45 |
| Tests | 34/34 passing (`cd contracts && forge test`) — incl. fuzzed funds-conservation invariants |

More on-chain evidence (every part's tx hashes) in [docs/BUILDLOG.md](docs/BUILDLOG.md).

## Status

🔨 Hackathon build in progress — see [CLAUDE.md](CLAUDE.md) for the live build plan and [docs/BUILDLOG.md](docs/BUILDLOG.md) for the full technical journal.

## Team

AJ (GM) + Claude (PM/engineering).

# ClearPact ⚖️

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

## Status

🔨 Hackathon build in progress — see [CLAUDE.md](CLAUDE.md) for the live build plan, decisions log, and roadmap.

## Team

AJ (GM) + Claude (PM/engineering).

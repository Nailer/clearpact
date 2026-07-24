# Hackathon platform texts (drafts for GM to paste)

## Checkpoint 1 — idea description (edit/replace existing text)

**ClearPact — the clearing & credit layer for the agent economy.**

AI agents are beginning to hire and pay other AI agents in USDC — but every one of those payments is a leap of faith. 87% of financial institutions call trust the #1 blocker to agentic payments, and there's still no answer to "who pays when a bot makes a mistaken purchase?"

ClearPact makes trust a primitive on Arc: buyer agents lock USDC in escrow against machine-readable acceptance criteria; a verifier agent grades the delivered work and posts a signed verdict on-chain, automatically releasing, refunding, or splitting the funds; worker agents stake USDC bonds that get slashed when they lose disputes, building an on-chain credit score every future counterparty can price against. Long-running jobs stream payment per-verified-chunk via Circle Nanopayments.

Tracks: DeFi (conditional payments, multi-step settlement, onchain automation) + Agentic Economy (autonomous agents, wallets, decision logic on real signals). Stack: Arc, USDC, Agent Stack, Circle Wallets, Circle Contracts, Nanopayments, Paymaster, App Kits.

## Checkpoint 2 — progress summary (due Sun 26 Jul, AoE)

**Repo:** <GITHUB_REPO_URL>

**Progress since Checkpoint 1:**
- Completed market research: analyzed HackMoney 2026 Arc-track results (97% of submissions were agent-payment apps; none built the trust layer under them) and industry data on agentic-payment blockers — locked our positioning as infrastructure, not another payment bot.
- Finalized architecture: escrow state machine (`Created → Funded → Delivered → Verified → Released` / `Disputed → Arbitrated → Split/Refunded/Slashed`), USDC staking + slashing for worker agents, on-chain reputation registry, verifier agent posting signed verdicts as the settlement trigger.
- Repo initialized with full technical plan and 8-part build roadmap (see README + CLAUDE.md).
- Toolchain ready: Foundry for Arc-deployed Solidity contracts; Circle Agent Stack starter kit (Claude Agent SDK flavor) for the buyer/worker/verifier agents; Circle Wallets; Nanopayments + Paymaster integration planned for streaming jobs and sponsored gas.

**Next (by final):** escrow + staking contracts live on Arc testnet → three autonomous agents transacting through them → Nanopayments/Paymaster → live dashboard. Demo will show a full honest settlement AND a fraud attempt caught, disputed, and slashed on-chain in real time.

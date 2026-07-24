# Project: ClearPact — Build on Arc Hackathon

> **READ THIS FIRST (for any Claude session — Claude Code or Claude chat/web):**
> This file is the single source of truth for this project. The human (AJ, the **General Manager**) works with Claude as the **Project Manager**. Claude must:
> 1. Read this whole file at the start of every session before doing anything.
> 2. **Update this file at the end of every working session** — add a dated entry to the Session Log, and update Status/Decisions/Next Steps so any other Claude session can pick up seamlessly.
> 3. Speak as a PM: give conclusions, recommendations, and trade-offs proactively; the GM makes final calls.

---

## 1. Hackathon context

**Build on Arc** — 4-week online hackathon by Circle. Build real products on **Arc** (Circle's stablecoin-native L1, USDC-denominated gas, sub-second settlement) using **USDC** as the money layer.

**Tracks** (a project may enter both if it genuinely qualifies — ours targets both):
- **DeFi track**: lending, swaps, FX, yield, payments, treasury. Judges want: meaningful Arc+USDC use, *advanced programmable money flows (conditional payments, onchain automation, multi-step settlement)*, App Kits where relevant.
- **Agentic Economy track**: AI agents that hold wallets and transact in USDC without a human in the loop. Judges want: *clear decision logic tied to real signals*, autonomous USDC settlement, use of **Agent Stack**, **Nanopayments**, **Paymaster**, App Kits.

**Core products to use**: Arc, USDC, App Kits (Send/Bridge/Swap/Unified Balance), Agent Stack, Circle Wallets, Circle Contracts, Nanopayments, Paymaster, CCTP, Gateway, StableFX.

**Key dates (deadlines are AoE / UTC-12):**
- ✅ Checkpoint 1 — Sun 19 Jul 2026: project created, team added, idea shared.
- ⚠️ **Checkpoint 2 — Sun 26 Jul 2026: repo link + progress summary.**
- Checkpoint 3 (FINAL) — **Sun 9 Aug 2026**: functional MVP deployed on Arc, public repo, 3-min video pitch + demo, deck.
- Demo Day — Thu 20 Aug 2026. Top ≤8 teams get an 8-week accelerator.

**Resources**: [Arc docs](https://docs.arc.io/) · [App Kits](https://docs.arc.io/app-kit) · [Circle dev platform](https://developers.circle.com/) · [Agent Stack starter kits](https://github.com/circlefin/agent-stack-starter-kits) · Build on Circle Discord.

## 2. The idea (status: PROPOSED — awaiting GM approval)

**ClearPact — the trust & settlement layer for the agent economy.**
An on-chain escrow + verification + reputation protocol on Arc that lets AI agents safely hire and pay other AI agents (or services) in USDC. Payment is **conditional on verified outcomes**, not promises.

**One-liner:** *Stripe holds money until delivery for humans; ClearPact does it for AI agents — escrow, automated verification, disputes, and credit scores for machines.*

### Why this idea (research findings, 23 Jul 2026)
- 97% of HackMoney 2026 Arc-track submissions were "AI agent makes payments" apps — marketplaces, booking agents, pay-per-API wrappers are **crowded**. The trust layer *underneath* them is the documented gap.
- Industry data: 87% of financial institutions cite **trust** as the #1 blocker to agentic payments; 78% fear fraud at scale; dispute resolution is explicitly called out as incomplete ("no definition of who pays when a bot makes a mistaken purchase"). Production teams hand-roll escrow + reputation — nobody has made it a primitive.
- Maps 1:1 onto the DeFi track's ask for "conditional payments, onchain automation, multi-step settlement" AND the Agentic track's "decision logic tied to real signals."

### How it works (technical)
1. **Escrow contract (Solidity, deployed on Arc testnet via Circle Contracts):** buyer agent locks USDC with a job spec hash, acceptance criteria, verifier address, deadline, and dispute window. States: `Created → Funded → Delivered → Verified → Released` (or `Disputed → Arbitrated → Split/Refunded/Slashed`).
2. **Worker agents** (built from Circle's Agent Stack starter kit, Claude Agent SDK flavor) hold Circle Wallets, accept jobs, deliver work (deliverable hash on-chain, payload off-chain).
3. **Verifier agent** — the "real signal": runs deterministic checks + LLM-judge against the acceptance criteria, posts a signed verdict on-chain. Verdict triggers automatic release.
4. **Reputation & staking:** worker agents stake USDC as a bond; disputes lost ⇒ slashed; jobs verified ⇒ on-chain reputation score. Buyers price risk by reputation.
5. **Nanopayments** for milestone/streaming jobs: pay-per-verified-chunk instead of one lump escrow. **Paymaster** sponsors agent gas. **App Kit Send** for final payout UX; **Unified Balance/Gateway** for cross-chain USDC in.
6. **Dashboard** (Next.js) showing live escrows, agent reputations, and money flow — the demo centerpiece.

### ELI10 version
Imagine robots doing homework for other robots for pocket money. Problem: a robot might pay first and get bad homework, or do the homework and never get paid — and robots can't call customer service. ClearPact is a super-fair robot referee: the paying robot puts the money in a locked glass box everyone can see. The working robot does the job. A checker robot grades the homework. Good grade → box opens, worker gets paid instantly. Bad grade → money goes back, and the cheating robot loses gold stars (and some of its own pocket money it had to put up). Every robot has a report card, so everyone knows who to trust.

### MVP scope for the 3-min demo
Two agents autonomously negotiate a job (e.g., "scrape & summarize X" or "generate a dataset"), escrow funds on Arc, deliver, get machine-verified, settle in USDC — then a second run where a bad delivery triggers dispute → slash → reputation drop. All visible live on the dashboard.

## 3. Tech stack (planned)
- Contracts: Solidity on Arc testnet (EVM-compatible), Foundry or Hardhat; deploy via Circle Contracts where possible.
- Agents: TypeScript, Circle Agent Stack starter kit (Claude Agent SDK variant), circle-tools wrappers, Circle Wallets, Nanopayments/x402, Paymaster.
- Frontend: Next.js dashboard + App Kits.
- Repo: this directory (`money-hack`). Not yet a git repo — needs `git init` + GitHub remote before Checkpoint 2 (26 Jul).

## 4. Decisions log
- 24 Jul 2026 — GM confirmed **Checkpoint 1 is done** (and remains editable — plan to sharpen its wording to the "clearing & credit layer" framing). GM raised saturation risk (others may AI-brainstorm the same idea); agreed differentiation strategy: (a) ship ClearPact as a **drop-in SDK** and offer it to other teams in the Circle Discord for real integrations, (b) make the **verifier + live failure/slash demo** the centerpiece (most teams will fake verification), (c) pitch as "the clearing and credit layer for the agent economy", not generic "escrow". Execution > secrecy.
- 23 Jul 2026 — PM proposed ClearPact after gap research. **GM reaction positive ("lovely idea"), formal go-ahead to build pending.** Alternates considered: agent-fleet treasury/payroll (too close to HackMoney winner ArcFlow), SLA-refund insurance for x402 APIs (folded into ClearPact as a feature idea).

## 5. Build plan — parts & gates (GM-approved process, 24 Jul 2026)

> **Process rule:** build one part at a time. At the end of each part, PM explains what was built in plain language, GM reviews and gives explicit go-ahead before the next part starts. PM lists GM-side tasks (account signups, submissions) at every gate — Claude cannot create accounts or submit on the hackathon platform.

| Part | What we build | Hackathon requirement it ticks | Target date | Status |
|------|---------------|-------------------------------|-------------|--------|
| **0** | Repo & Checkpoint 2: git init, README, structure, GitHub push, progress summary | Public repo requirement; Checkpoint 2 (26 Jul) | 24–25 Jul | 🔨 in progress |
| **1** | Environment: Circle dev account, Arc testnet RPC, testnet USDC, Circle Wallets for 3 agents | Arc, USDC, Circle Wallets | 25–26 Jul | ⬜ |
| **2** | `ClearPactEscrow.sol`: state machine (Created→Funded→Delivered→Verified→Released / Disputed→…), Foundry tests, deploy to Arc testnet | Conditional payments, multi-step settlement, Circle Contracts | 27–29 Jul | ⬜ |
| **3** | Reputation & staking: worker bonds, slashing, on-chain reputation registry | Onchain automation; the "credit layer" story | 29–31 Jul | ⬜ |
| **4** | Agents: buyer, worker, verifier (Agent Stack starter kit, Claude Agent SDK flavor); verifier posts signed verdicts on-chain | Agent Stack, autonomous USDC settlement, decision logic tied to real signals | 1–4 Aug | ⬜ |
| **5** | Nanopayments (milestone/streaming pay-per-verified-chunk) + Paymaster (sponsored agent gas) | Nanopayments, Paymaster | 4–5 Aug | ⬜ |
| **6** | Next.js dashboard (live escrows, reputation, money flow) + App Kits (Send / Unified Balance) | App Kits; demo centerpiece | 5–7 Aug | ⬜ |
| **7** | SDK packaging (drop-in escrow wrapper), 3-min video, deck, **final submission (submit EARLY — platform locks 9 Aug AoE)** | Final deliverables; SDK differentiation play | 7–8 Aug | ⬜ |

**Requirements coverage check:** Arc ✓(P1,2) · USDC ✓(all) · App Kits ✓(P6) · Agent Stack ✓(P4) · Circle Wallets ✓(P1) · Circle Contracts ✓(P2) · Nanopayments ✓(P5) · Paymaster ✓(P5) · Gateway ✓(P5, via Nanopayments) · conditional/multi-step flows ✓(P2,3) · agent decision logic on real signals ✓(P4). CCTP/StableFX: optional stretch, not required for our story.

### GM task list (things only AJ can do)
- [ ] Create GitHub repo & push (PM preps everything; or install `gh` CLI + `gh auth login` and PM does it)
- [ ] Sign up at [Circle developer console](https://console.circle.com/) and get API keys (PM must never handle account creation/passwords)
- [ ] Edit Checkpoint 1 wording to "clearing & credit layer" framing (PM drafts text)
- [ ] Submit Checkpoint 2 on the hackathon platform before Sun 26 Jul (repo link + PM-drafted summary)
- [ ] Later: record/approve 3-min video, submit final before 9 Aug AoE

## 6. Session log (newest first — every session appends here)
- **24 Jul 2026 (Claude Code, session 2):** GM gave green light with staged-build process (parts + go-ahead gates). Added §5 build plan (Parts 0–7) with requirement-coverage map and GM task list. **Part 0 executed:** git repo initialized (`main`, first commit), README, .gitignore, `docs/submissions.md` (Checkpoint 1 reword + Checkpoint 2 summary drafts). `gh` CLI not installed → GM must create the GitHub repo and push (commands provided in chat), or install `gh` for PM to do it. Toolchain verified: git 2.46.2, node 24, Foundry 1.3.5. **Gate open: awaiting GM go-ahead for Part 1** (Circle dev account + Arc testnet env + wallets).
- **24 Jul 2026 (Claude Code):** GM confirmed Checkpoint 1 complete. Discussed idea-saturation risk; locked differentiation strategy (SDK play + Discord integrations, verifier-with-live-slash demo, "clearing & credit layer" positioning). Awaiting GM's explicit green light to scaffold repo/contracts — Checkpoint 2 due 26 Jul.
- **23 Jul 2026 (Claude Code):** Project kickoff. Researched Arc docs, Agent Stack starter kits, Nanopayments/x402, prior Arc hackathon winners (HackMoney 2026: arctan(x), Text-to-Chain, ArcFlow, Versus; Agentic Economy Apr 2026: Cairn, Sendero, npm-security-x402). Identified trust/dispute/reputation gap. Proposed ClearPact. Created this CLAUDE.md. No code yet; directory empty otherwise.

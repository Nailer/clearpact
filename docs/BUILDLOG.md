# ClearPact — Technical Build Log

> Structured engineering journal for the Build on Arc hackathon. One entry per
> build part: objective, decisions, evidence. Companion to
> [CLAUDE.md](../CLAUDE.md) (project management) and the README (product).
> Newest part last — read top-to-bottom as the story of the build.

---

## Part 0 — Foundation & Checkpoint 2 (24 Jul 2026)

**Objective:** public repo + submission-ready positioning before the 26 Jul checkpoint.

**Research that shaped the idea:**
- Analyzed ETHGlobal HackMoney 2026 Arc-track results: 97% of 155 submissions were "agent makes payments" apps; winners (arctan(x), Text-to-Chain, ArcFlow, Versus) and the April Agentic Economy winners (Cairn, Sendero) all built *payment* flows — none built the trust layer beneath them.
- Industry signals: 87% of financial institutions cite trust as the #1 blocker for agentic payments; dispute resolution called out as unsolved ("who pays when a bot makes a mistaken purchase?"). Production teams hand-roll escrow/reputation.
- Positioning locked: **"the clearing & credit layer for the agent economy"** — escrow + machine verification + staked reputation as a primitive, shipped as an SDK others can drop in.

**Artifacts:** repo init (`main`), README, `.gitignore`, `docs/submissions.md` (checkpoint texts), 8-part build plan with requirement-coverage map in CLAUDE.md.

---

## Part 1 — Arc testnet environment (24 Jul 2026)

**Objective:** verified connection to Arc + full toolchain + agent framework scaffold.

**What was done:**
- Verified Arc testnet live by direct RPC call: chain ID `0x4cef52` = **5042002**, RPC `https://rpc.testnet.arc.network`, explorer `https://testnet.arcscan.app`, faucet `https://faucet.circle.com`.
- Foundry project in `contracts/` — solc 0.8.26, optimizer on, `arc_testnet` RPC endpoint configured in `foundry.toml`.
- Vendored [circlefin/agent-stack-starter-kits](https://github.com/circlefin/agent-stack-starter-kits) (Apache-2.0) into `agents/`: `circle-tools` (Circle CLI wrappers), `agent-cli` (Ink terminal UI), `claude-agent-sdk` kit. `bun install` + typecheck pass.
- Circle CLI v0.0.6 installed globally; deployer wallet generated and faucet-funded with 20 testnet USDC.

**Discoveries & gotchas (the details that cost time):**
1. **USDC is Arc's native gas token with 18 decimals** (not the usual ERC-20 6). Contracts hold and move USDC like ETH — `msg.value`, no `approve/transferFrom`. This is the "why stablecoin-native changes what's possible" story in one line.
2. Circle CLI auth is **email + OTP** (`circle wallet login`), not an API key. The starter kit README says `circle login` — stale; v0.0.6 moved it under the `wallet` resource.
3. Circle console has three key types: plain **API Key** (Wallets/Contracts — what we use), Kit Key (App Kits, needed Part 6), Client Key (Modular Wallets SDK — not needed).
4. **Circle CLI natively supports ARC-TESTNET** (`circle blockchain list`) including wallet create + faucet fund — de-risks agent wallets in Part 4.
5. Upstream starter kit demo pays x402 services on **Base mainnet** by default; our agents will be repointed to Arc testnet contracts (Part 4) with Nanopayments/Gateway wiring verified in Part 5.

---

## Part 2 — ClearPactEscrow contract, live on Arc (24 Jul 2026)

**Objective:** the conditional-settlement state machine — written, tested, deployed, and exercised end-to-end on Arc testnet.

**Contract design (`contracts/src/ClearPactEscrow.sol`):**
- State machine: `Created → Delivered → Verified → {Released | Refunded}` with `Disputed → Resolved` (arbiter split) and `Created → Refunded` (deadline expiry). Fast path: buyer `acceptDelivery()` skips verification.
- **Native-USDC escrow:** `createJob` is `payable`; the escrow *is* the chain's value token. No token address, no approvals — impossible on any general-purpose L1 where gas ≠ dollars.
- Verifier posts `submitVerdict(jobId, score 0–100, verdictHash)`; `score >= passScore` (per-job threshold) decides release vs refund. Verdict opens a dispute window; `settle()` is permissionless after it closes — settlement needs *no* trusted party once the verdict is on-chain.
- `dispute()` (buyer or worker, inside window) freezes settlement; `arbitrate(workerBps)` splits funds in basis points. Arbiter is the deployer for the MVP; Part 3 evolves this toward staked arbitration + reputation.
- Safety: checks-effects-interactions, reentrancy lock, custom errors, funds-conservation invariant (fuzz-tested), self-dealing guard (buyer ≠ worker), score cap, packed structs (single-slot-friendly `uint96` amount / `uint64` times / `uint8` scores).

**Tests (`contracts/test/ClearPactEscrow.t.sol`):** 21 tests, all passing — full happy path, failing-verdict refund, exact-threshold boundary, buyer fast path, expiry, dispute-then-arbitrate split, window edge cases (settle-during-window, dispute-after-window, settle-when-disputed), fuzz test proving `worker + buyer payouts == escrow` for any split, and 7 access-control/guard tests.

**Deployment (Arc testnet, chain 5042002):**

| What | Value |
|------|-------|
| Contract | [`0x696c726845b1a1192b7f5b86394dfda304d1062f`](https://testnet.arcscan.app/address/0x696c726845b1a1192b7f5b86394dfda304d1062f) |
| Deploy tx | `0x1c2b5193f5ac3726db4e1e1db0450a20cb24d9599452667b0cdf02a8f323ea97` |
| Deploy cost | ~0.033 USDC (dollar-denominated gas — cost known in advance) |

**Live smoke test — a real job settled on Arc:**

| Step | Actor | Tx |
|------|-------|----|
| `createJob` (0.5 USDC escrowed) | buyer `0x2959…5b5E` | `0x06b4e73cac3e2f12821675a0b0179c201b451ca82e7e5fe4beef2370597bdd16` |
| `deliver` | worker `0x9022…b169` | ✓ |
| `submitVerdict(95)` | verifier `0xf716…8782` | ✓ |
| `settle` → 0.5 USDC to worker | anyone | ✓ status `Released` |

Three independent wallets, four transactions, end-to-end conditional settlement in seconds — sub-second finality means an agent needn't "wait for confirmations" before acting on payment.

**Next (Part 3):** staking + reputation — worker bonds, slashing on lost disputes, on-chain reputation registry.

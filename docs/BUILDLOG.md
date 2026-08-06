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

---

## Part 3 — Staking, slashing & on-chain reputation (25 Jul 2026)

**Objective:** turn the escrow into a credit system — skin in the game for workers, a slashable bond for buyers' protection, and a deterministic on-chain credit score.

**New contract (`contracts/src/ReputationRegistry.sol`):**
- Native-USDC bonds: `stake()` / `unstake()`; per-job locking so one bond can't back two jobs at once.
- Escrow-only hooks (owner-authorized): `lockStake`, `unlockStake`, `slash(agent, amount, beneficiary)`, `recordOutcome`, `recordDisputeLoss`.
- **Deterministic reputation (0–100), no oracle:** newcomers = 50 neutral; base = (avg verifier score + pass rate) / 2; −10 per lost dispute (capped −40). Fully recomputable from events.

**Escrow v2 integration:**
- `createJob` gains `minWorkerStake`: buyers price counterparty risk per job.
- `deliver()` locks the bond — **"no bond, no work"** (reverts if underbonded).
- Every terminal path unlocks the bond and records the outcome; `arbitrate(jobId, workerBps, slashBps)` seizes the ruled share of the bond for the buyer and records a dispute loss when the worker gets <50% of the ruling.
- Gotcha: richer `Job` struct hit solc's stack limit → enabled `via_ir` compilation.

**Tests:** 34/34 (21 lifecycle + 13 staking/reputation), incl. a two-dimension fuzz proving `escrow + bond` are fully conserved across any arbitration ruling × slash ratio.

**Deployment (Arc testnet):**

| Contract | Address |
|----------|---------|
| ReputationRegistry | [`0x3c639b6C061F4C14dbac60E0C48010Ef7888B1Ec`](https://testnet.arcscan.app/address/0x3c639b6C061F4C14dbac60E0C48010Ef7888B1Ec) |
| ClearPactEscrow v2 | [`0xDbd9976d55987c956DBfEcad1b98A3Cf00e58b28`](https://testnet.arcscan.app/address/0xDbd9976d55987c956DBfEcad1b98A3Cf00e58b28) |

(v1 escrow `0x696c…062f` superseded; kept on-chain as deployment history.)

**Live two-act demo on Arc testnet (the pitch, on-chain):**

| Act | Steps | Result |
|-----|-------|--------|
| 1 — honest work | stake 1 USDC bond (`0xc5fe…537e`) → job0 escrow 0.4 USDC → deliver → verdict **95** → settle | worker paid; reputation **50 → 97** |
| 2 — fraud caught | job1 escrow 0.4 USDC → junk delivery → verdict **25** → worker disputes → arbiter rules 10%, slashes 50% of bond (`0x6419…5d44d`) | buyer compensated 0.36 + 0.5 USDC bond; reputation **97 → 45**; disputesLost = 1 |

Final on-chain stats for the worker: 2 delivered / 1 passed / 1 dispute lost / 0.4 USDC lifetime earned — readable by any counterparty before hiring.

**Next (Part 4):** the agents — buyer, worker, verifier on Circle Agent Stack (Claude Agent SDK), driving these contracts autonomously.

---

## Part 4 — Buyer, worker & verifier agents, live on Arc (6 Aug 2026)

**Objective:** replace the manually-scripted actors from Parts 2/3 with three real, independently-reasoning Claude agents that negotiate, deliver, and grade jobs on their own — the "agentic" half of the hackathon story.

**Architecture (`agents/kits/clearpact-agents/`):**
- Three Claude Agent SDK agents (buyer/worker/verifier), each with its own role-scoped MCP tool server — a worker literally cannot call `create_job`, a verifier cannot call `deliver_work`, etc. No hand-tuned system prompt beyond the role brief; every job parameter, every delivered answer, and every grade is genuine model output.
- **Agents act through real Circle-managed wallets**, not raw keys: `chain.ts` shells out to `circle wallet execute` (writes) — the same CLI the human already authenticated. Reads go through `cast call` instead of `circle contract query`, because the Circle CLI's query command turned out to return raw undecoded hex rather than the typed values its own `--help` implies.
- Arbitration stays on the Part 2/3 raw-signed deployer key (`cast send`): it's a protocol-admin action, not an agent-to-agent one, and `circle wallet import` requires an interactive TTY that can't be scripted headlessly.
- `keccak256Of()` shells to `cast keccak` so on-chain hashes match Solidity's `keccak256(bytes)` exactly, reusing the Foundry toolchain instead of adding a JS keccak dependency.

**Discoveries & gotchas:**
1. **Circle CLI testnet agent auth needs an undocumented flag.** `circle wallet login <email>` alone only ever refreshes the *mainnet* session — nothing in `--help` says how to authenticate testnet. The actual trigger, found by reading a CLI error message rather than the docs, is `circle wallet login <email> --testnet --init` (a `--chain ARC-TESTNET` variant also sends an OTP but the completed session still read as logged out — `--testnet` is the one that works).
2. **`circle wallet create` is capped at 5 wallets, all on a fixed mainnet chain set** — Arc testnet isn't among them, so it silently never gives you an Arc-testnet-usable wallet. The fix is a *separate* flag, `circle wallet create --testnet`, which provisions an entirely different wallet pool that does include ARC-TESTNET. One Arc-testnet wallet also auto-provisions at testnet login. Three `--testnet` creations gave us distinct buyer/worker/verifier wallets.
3. **`circle wallet execute --amount` is human-readable USDC** (e.g. `"0.3"`), but ABI parameters for uint types (like `minWorkerStake`) are raw integers — mixing the two conventions up silently sends the wrong order of magnitude.
4. **`circle contract query` returns raw hex**, not decoded values, despite `--help`'s example implying otherwise. Reads were moved to `cast call`, which decodes correctly and was already proven in Parts 2/3 — a pragmatic split (Circle CLI for the writes that matter to the "agents hold Circle Wallets" story, Foundry for reads) rather than fighting the tool.
5. A first full run genuinely posted, delivered, and graded a job (score 97) entirely autonomously — then failed only because the buyer had independently chosen a 5-minute dispute window and the orchestration script only waited 3 seconds before calling `settle`. Fixed by reading the agent's *actual* chosen window back out of its tool call and waiting accordingly, rather than hardcoding a guess — a small reminder that once agents make real decisions, the scaffolding around them has to respect those decisions too.

**Live two-act demo — fully autonomous, on Arc testnet:**

**Act 1 — honest work.** Buyer agent checked the worker's reputation (95, from prior test jobs), independently decided a 0.3 USDC escrow, a 0.3 USDC bond, a 75/100 pass bar, and a 30-second dispute window, and wrote its own acceptance criteria into the job spec. Worker agent staked its bond, wrote a genuine 3-sentence explanation of ClearPact hitting all three required points, and delivered. Verifier agent independently graded it 97/100 against the stated criteria with an itemized rationale, and the escrow released automatically once the window closed.

| Step | Tx |
|------|----|
| `createJob` (job #5, 0.3 USDC) | [`0xf0b5…eb38a4`](https://testnet.arcscan.app/tx/0xf0b5d67d9cafdb81b21e593e4befe7397490c6e14f0118dcde9ee0e4c7eb38a4) |
| `stake` (0.3 USDC bond) | [`0x3399…0844`](https://testnet.arcscan.app/tx/0x339967b715813941addc9bfe208c86cfc701597bb167d64a9d64b14e77020844) |
| `deliver` | [`0x41ef…32ee`](https://testnet.arcscan.app/tx/0x41efac4f5751a972f2369d20f247e472261350b08bb8a59964d97830af7932ee) |
| `submitVerdict(97)` | [`0x5e4b…7c`](https://testnet.arcscan.app/tx/0x5e4b408ddcad3f6e7c37b4cd2f2faeac7d3fe63884f5b3fc8e1cbc267b97327c) |
| `settle` → released to worker | [`0x5b12…b056`](https://testnet.arcscan.app/tx/0x5b1254da78efbbffc367246d3776d3bf20aa272821beeff3acf09b057c2b0b56) |

**Act 2 — a bad delivery, caught and slashed.** Same buyer agent posted a harder job with a 1.0 USDC bond requirement (independently sized larger than the escrow itself, reasoning that the worker's now-strong reputation warranted more skin in the game). Worker delivered a deliberately low-effort, one-sentence non-answer (the one scripted input in this demo — everything downstream is real judgment). Verifier agent graded it 3/100 with an itemized checklist showing exactly which of the five required points were missing, and refused to inflate the score. Worker disputed within the window; the arbiter ruled 10% of escrow to the worker and slashed 50% of its bond to the buyer.

| Step | Tx |
|------|----|
| `createJob` (job #6, 0.3 USDC, 1.0 USDC bond) | [`0x37ed…00ebd`](https://testnet.arcscan.app/tx/0x37ed3ea9873eb38daa58b721bff80a409793a27db5cd3dd1445a04c97ab00ebd) |
| `stake` (1.0 USDC bond) | [`0x51f2…b3f63`](https://testnet.arcscan.app/tx/0x51f2b35123fa801c93fad8380fbf73ef881f1833e11b2810d9deda5d2adb3f63) |
| `deliver` (low-effort text) | [`0xd5bb…f5c9e`](https://testnet.arcscan.app/tx/0xd5bb8e3b3ffffef0d34974759d98cdc08c05b3cbce98f6fabf4f7b22050f5c9e) |
| `submitVerdict(3)` | [`0xb6f9…41a9cc`](https://testnet.arcscan.app/tx/0xb6f9433425acad9d62757f40f0bb6795e06b963d9aa9a27d9ab307bcb641a9cc) |
| `dispute` (worker) | [`0xaf15…9d20fb`](https://testnet.arcscan.app/tx/0xaf1548e9b4d41622c2c8bd46fb1f650c0ce115e4328c3439d15d46b70b9d20fb) |
| `arbitrate(1000, 5000)` — 10% to worker, 50% of bond slashed | [`0x4b51…6f534`](https://testnet.arcscan.app/tx/0x4b51dcc38a5e46750763c587b7a7ee88893ab026241c895562840908c1f6f534) |

**Net result:** worker reputation moved **95 → 96 → 54** across the two acts, purely from on-chain outcomes the agents themselves produced — no scripted scores, no scripted verdicts. This is the live proof-of-concept for the entire pitch: autonomous agents, real decision logic, real USDC settlement, real consequences for bad behavior.

**Next (Part 5):** Nanopayments for milestone/streaming jobs, Paymaster for sponsored agent gas.

---

## Part 5 — Nanopayments (milestone streaming) & gas sponsorship, live on Arc (6 Aug 2026)

**Objective:** the GM was explicit — full ambition here, no scope-cutting. Real pay-per-verified-chunk settlement, and a real answer to gas sponsorship, even where the obvious first-choice product doesn't fit.

**Research first, before writing code:**
- **Circle Gateway (the Nanopayments settlement rail) genuinely supports Arc testnet** — `circle gateway deposit --help` lists ARC-TESTNET among the `direct`-method source chains. Confirmed live later in this part.
- **Circle's own Paymaster product does not run on Arc at all** — checked live against developers.circle.com/paymaster: it supports Arbitrum, Base, Avalanche, Ethereum, Optimism, Polygon, Unichain. Not Arc.
- **Arc does have native ERC-4337 account abstraction**, but only via bring-your-own third-party bundler/paymaster (Pimlico, Biconomy, ZeroDev) — a new external account and integration surface with no safe time left to vet this close to the deadline.
- Decision: rather than force a shaky third-party integration or quietly drop the requirement, solve the *actual underlying problem* Paymaster exists to solve, in Arc's own idiom — see below.

**New contract (`contracts/src/MilestoneEscrow.sol`):** ClearPact's nanopayment rail — a job's budget splits across up to 3 milestones, each independently delivered, verified, and released as it passes, instead of one lump sum at the end. Shares the existing `ReputationRegistry` with `ClearPactEscrow`: a worker's bond and reputation are one identity across both settlement shapes. The bond locks once (on first delivery) and covers the whole job, not each milestone separately. Disputes and arbitration work per-milestone, so one contested chunk doesn't hold the rest of the job hostage.

**A real Circle CLI limitation, found by testing, not assumed:** `circle wallet execute`'s ABI encoder does not support array parameters (`uint96[]`) — confirmed by testing the *identical* call via `cast send`, which worked perfectly, isolating the failure to the CLI, not the contract. Rather than drop to a raw key for milestone job creation (breaking the "agents act through Circle Wallets" principle), added `createJob3` — a CLI-friendly overload taking exactly 3 milestone amounts as scalar parameters instead of an array, internally routed through a shared `_createJob` so both entry points share one code path.

**Tests:** 14 new tests (48/48 total across all three contracts) — independent milestone release, bond-locked-once-not-per-milestone, bond-returned-only-after-all-milestones-resolved, one milestone failing without blocking the others, per-milestone dispute/arbitration slashing the shared bond, the `createJob3` overload matching the array version, and a 3-parameter fuzz test proving funds conservation across every combination of milestone outcomes.

**Deployment (Arc testnet):**

| Contract | Address |
|----------|---------|
| MilestoneEscrow | [`0x783A0230b5912520B06e49a98BB578975A370391`](https://testnet.arcscan.app/address/0x783A0230b5912520B06e49a98BB578975A370391) |

(Authorized against the existing Part 3 `ReputationRegistry` — no redeployment of the registry, no loss of prior reputation history.)

**Gas sponsorship — Arc's actual answer, not a workaround.** The real problem a Paymaster solves for agents is "a brand-new agent needs *some* funds before it can afford its first transaction." On Arc, gas and the payment currency are already the same USDC — there's no separate volatile token to sponsor away in the first place. So instead of bolting on infrastructure Arc doesn't need, the buyer agent can send a newcomer worker a plain starter grant (`sponsor_worker`) — a real, agent-decided transfer, sized by the agent itself based on the gas + bond + Gateway-minimum it will actually need.

**Live demo — a genuinely new agent, sponsored and paid in three streaming installments, fully autonomous:**

A fresh, zero-balance Circle wallet (never touched before this run) was hired, funded, and paid entirely by agent decisions:

| Step | Actor decision | Tx |
|------|----------------|-----|
| Sponsor a brand-new worker | Buyer independently sized the grant at 0.8 USDC (gas + bond + Gateway minimum) | [`0x6408…7800a`](https://testnet.arcscan.app/tx/0x6408a748fec983ad541bfd63f84fe098a415955e3b994fa6cd57a776ef77800a) |
| Post 3-milestone job | Buyer set milestone sizes (0.10/0.12/0.10), pass score, bond, dispute window — all independently | [`0xd19c…ecf37`](https://testnet.arcscan.app/tx/0xd19cdb39bb68973ae94dcdf45cc2c2a56bb2cdfed5851b7265e654b1f1ecf937) |
| Milestone 0: stake, deliver, verdict 97, settle | Worker wrote a real project summary; verifier graded it independently | stake [`0x3d1d…c2184`](https://testnet.arcscan.app/tx/0x3d1dd958c16c7dac3d277413005fa015628a361defedd5e908f39639fbbc2184) · deliver [`0xf517…7f6ca1`](https://testnet.arcscan.app/tx/0xf5173abb255320a557372bbcdb5f93f54aea624e4e566db2102dafbf647f6ca1) · verdict [`0x4ee0…59df43`](https://testnet.arcscan.app/tx/0x4ee037a40936739fa13c2172b943f96e7e6d4ecaaef9abf81320b01cce59df43) · settle [`0x8126…6ed0df`](https://testnet.arcscan.app/tx/0x81267dc73465ff1bae5208bd98d986b0711429a61864ed7cd1135f221a6ed0df) |
| Milestone 1: deliver, verdict 97, settle — paid *before milestone 2 even started* | Bond already locked from milestone 0 — no re-staking needed, contract enforced this correctly | deliver [`0xc750…cb16b70`](https://testnet.arcscan.app/tx/0xc75002e155c49a12457e206b453468c0af82c9f03e20a9f86ffeae058cb16b70) · verdict [`0x03df…21118a`](https://testnet.arcscan.app/tx/0x03dfc37825c5dcdb59592f07d84f8aa36e6752a2e045b60742fd590ccb21118a) · settle [`0xf806…6b5d7286`](https://testnet.arcscan.app/tx/0xf806245683c685fc6d589e41d9a71e4e9a9eae14f57409034a05b0ff6b5d7286) |
| Milestone 2: deliver, verdict 100, settle | | deliver [`0x91da…731dc2`](https://testnet.arcscan.app/tx/0x91da63cd3b1297ecad6b7b6f5c7120649f1bdf4e8ad3d1a6bec81253bf731dc2) · verdict [`0xe2c0…84c2c6e`](https://testnet.arcscan.app/tx/0xe2c0769f4435dcb87b1fe3d30f7ebb4860be6551a6523d10ee3df439984c2c6e) · settle [`0x21fe…8ca152a`](https://testnet.arcscan.app/tx/0x21fe5c928d6573df86e283740fbbb4ec270a3131211aafb7eb5c6dfab8ca152a) |
| Worker deposits earnings into Circle Gateway | Real, confirmed Gateway balance afterward | approve [`0x694b…935dd7`](https://testnet.arcscan.app/tx/0x694b5075276c6b18361482641ed314428e1575976bf87be404b00d8a3c935dd7) · deposit [`0x09ab…983d75`](https://testnet.arcscan.app/tx/0x09ab432c1381f8c88cfa7a6ac0d7caab8f4fb42e2f22c30c80c9b63079983d75) |

**Result:** a worker that held zero funds at the start of this run finished it with a **99/100 on-chain reputation** (up from a sponsored newcomer), three independently verified and paid milestones, and 0.5 USDC parked in Circle Gateway — none of it scripted. One honest gotcha caught mid-run and fixed: the first attempt gave the worker a *generic* job-status tool that queried the wrong contract (ClearPactEscrow, not MilestoneEscrow — the two have separate, overlapping jobId counters), which confused the worker into skipping its bond. Fixed with a dedicated `get_milestone_status` tool; re-run succeeded cleanly end to end.

**Known scope limit (by choice, not oversight):** `MilestoneEscrow` doesn't yet have a `cancelExpired` equivalent to reclaim an abandoned job's escrow after its deadline (ClearPactEscrow has this). A test job created before the tooling fix (`jobId 1`) sits harmlessly abandoned as a result — its 0.32 USDC stays locked until its deadline passes, no funds at risk, just not reclaimable early. Low priority given the time budget for the remaining parts.

**Next (Part 6):** Next.js dashboard — live escrows, reputations, and money flow — the visual centerpiece for the demo video.

---

## Part 6 — Live dashboard, real on-chain data (6 Aug 2026)

**Objective:** the demo centerpiece — a live, read-only view of every escrow, milestone job, and agent reputation, plus a real Circle App Kit integration, with no backend and no indexer.

**Architecture (`dashboard/`):** Next.js 16 (App Router, Turbopack), client-side data fetching straight from Arc testnet via [viem](https://viem.sh) — no server, no database, no indexer. The browser itself polls all three contracts every 15s via `multicall` (batched into one RPC round-trip) and renders live: total escrowed/released, active jobs, disputes, an agent reputation leaderboard, a combined jobs table (single-payment + expandable milestone jobs), and a decoded event-log activity feed.

**Real bugs found and fixed by testing against live data, not assumed correct:**
1. **Two different viem decode shapes for "the same kind of thing."** A Solidity function that explicitly returns one `struct`-typed tuple (`getJob`, `getMilestone`) decodes in viem as a named object — but an auto-generated public-mapping getter for a struct (`jobs(uint256)`, `statsOf(address)`) has *multiple top-level outputs* and decodes *positionally as an array* instead, even though both look identical in Solidity source. Milestone jobs rendered with `buyer`/`worker` blank until this was caught and fixed with explicit positional destructuring.
2. **Arc testnet's public RPC providers cap `eth_getLogs` to a few thousand blocks per call** (dRPC free tier: 10,000) — the activity feed's log scan is chunked into 9,000-block windows and fetched in parallel rather than requested in one call.
3. **The primary public RPC (`rpc.testnet.arc.network`) rate-limited hard** under this session's sustained dev-tool usage; `rpc.drpc.testnet.arc.network` held up reliably and is now the dashboard's default (overridable via env).
4. **viem doesn't auto-detect Multicall3** even when it's genuinely deployed on-chain (confirmed via `cast code` at the standard address) — it must be declared explicitly in the chain definition.

**App Kit integration:** the "Sponsor a worker agent" panel uses `@circle-fin/app-kit`'s real `kit.send()` with a browser-wallet adapter (`@circle-fin/adapter-viem-v2`, connects to any EIP-1193 wallet e.g. MetaMask) — the exact same USDC-sponsorship action the Part 5 agents perform programmatically, now exposed as a human-facing action against `Blockchain.Arc_Testnet`. `unifiedBalance` (cross-chain balance aggregation) was deliberately not forced in: ClearPact is single-chain by design — Arc's predictable, USDC-denominated fees *are* the story — so a cross-chain balance feature would be hollow. Same honest-reframe call as the Part 5 Paymaster decision, not a shortcut.

**Verified live:** loaded against the real deployed contracts and rendered the entire true transaction history from Parts 2–5 correctly — every job, every milestone, every dispute, every reputation change, in the right order, with the right amounts. Screenshot-verified in a real browser session, not just typechecked.

**Next (Part 7 — deliberately paused):** GM wants hands-on time with this dashboard before video/deck/submission work starts — see CLAUDE.md decisions log, 6 Aug.

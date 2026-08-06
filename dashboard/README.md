# ClearPact dashboard

Live, read-only view of ClearPact's on-chain state on Arc testnet — escrows, milestone/streaming jobs,
agent reputation, and a real-time activity feed — plus a Circle App Kit "sponsor an agent" panel.

## Run it

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). No accounts or API keys needed — it reads
directly from Arc testnet via public RPC. Contract addresses default to the live Part 2/3/5
deployment; override via `.env.local` if you redeploy (see `src/lib/config.ts`).

## What it reads

- `ClearPactEscrow` — single-payment jobs (state machine, verdicts, disputes)
- `MilestoneEscrow` — 3-milestone streaming-payment jobs
- `ReputationRegistry` — every worker's bond and credit score

All three are polled every 15s directly from the browser via [viem](https://viem.sh) — no backend,
no indexer. Event history (the activity feed) is fetched via `eth_getLogs`, chunked to stay under
Arc testnet RPC providers' block-range limits.

## App Kit

The "Sponsor a worker agent" panel uses `@circle-fin/app-kit`'s real `kit.send()` with a
browser-wallet adapter (`@circle-fin/adapter-viem-v2`, EIP-1193) — the same USDC-sponsorship
primitive the Part 5 agents use programmatically, exposed here as a human-facing action. Requires
a browser wallet (e.g. MetaMask) connected to Arc testnet.

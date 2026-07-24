# ClearPact agents

Buyer, worker, and verifier agents built on the **Circle Agent Stack**.

Vendored from [circlefin/agent-stack-starter-kits](https://github.com/circlefin/agent-stack-starter-kits) (Apache-2.0, see [LICENSE](LICENSE)):

- `packages/circle-tools` — framework-agnostic wrappers around the Circle CLI (wallets, balances, service discovery, x402 payments)
- `packages/agent-cli` — shared Ink terminal chat UI
- `kits/claude-agent-sdk` — Claude Agent SDK harness (our base; will become the ClearPact buyer/worker/verifier agents in Part 4)

## Notes from upstream

- Circle CLI auth is **email + OTP** via `circle login` (credentials in `~/.circle`) — there is no API key for the CLI.
- The upstream demo kit pays x402 services on Base mainnet; ClearPact's escrow settlement contracts live on **Arc testnet** (chain 5042002) — the agents will be repointed there in Part 4, with Nanopayments/Gateway wiring in Part 5.

## Setup

```bash
bun install          # from this directory
circle login         # one-time, email + OTP (human does this)
```

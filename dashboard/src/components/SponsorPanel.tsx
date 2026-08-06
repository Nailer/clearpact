"use client";

import { useState } from "react";
import { explorerTx } from "@/lib/config";

type Phase = "idle" | "connecting" | "sending" | "done" | "error";

/**
 * Real Circle App Kit `send` — the same primitive the Part 5 agents used
 * programmatically (`sponsor_worker`), now exposed as a human-facing action.
 * A connected browser wallet funds a worker's starter grant directly on Arc.
 *
 * App Kit's `unifiedBalance` is deliberately not used here: ClearPact is
 * single-chain by design (Arc's predictable USDC-denominated fees are the
 * point), so cross-chain balance aggregation isn't a meaningful fit — same
 * honest-reframe call as the Part 5 Paymaster decision.
 */
export function SponsorPanel() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [account, setAccount] = useState<string | null>(null);
  const [workerAddress, setWorkerAddress] = useState("");
  const [amount, setAmount] = useState("0.5");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setError(null);
    setPhase("connecting");
    try {
      const eth = (window as unknown as { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
      if (!eth) throw new Error("No browser wallet found (install MetaMask or similar).");
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      setAccount(accounts[0]);
      setPhase("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  async function sponsor() {
    setError(null);
    setTxHash(null);
    setPhase("sending");
    try {
      const eth = (window as unknown as { ethereum?: unknown }).ethereum;
      if (!eth) throw new Error("No browser wallet found.");
      if (!workerAddress.startsWith("0x") || workerAddress.length !== 42) {
        throw new Error("Enter a valid worker address (0x...).");
      }

      const [{ AppKit, Blockchain }, { createAdapterFromProvider }] = await Promise.all([
        import("@circle-fin/app-kit"),
        import("@circle-fin/adapter-viem-v2"),
      ]);

      const adapter = await createAdapterFromProvider({ provider: eth as never });
      const kit = new AppKit();
      const step = await kit.send({
        from: { adapter, chain: Blockchain.Arc_Testnet },
        to: workerAddress,
        amount,
        token: "USDC",
      });

      const hash = (step as unknown as { txHash?: string; hash?: string }).txHash ?? (step as unknown as { hash?: string }).hash ?? null;
      setTxHash(hash);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5 flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium">Sponsor a worker agent</h3>
        <p className="text-xs text-text-dim mt-1">
          Send a starter USDC grant to a new agent via Circle App Kit — the same primitive our buyer agent uses
          programmatically in Part 5, here as a real wallet-connected action.
        </p>
      </div>

      {!account ? (
        <button
          onClick={connect}
          disabled={phase === "connecting"}
          className="self-start rounded-lg bg-teal/15 border border-teal/30 text-teal px-4 py-2 text-sm font-medium hover:bg-teal/25 transition-colors disabled:opacity-50"
        >
          {phase === "connecting" ? "Connecting…" : "Connect wallet"}
        </button>
      ) : (
        <>
          <p className="text-xs text-text-dim font-mono">connected: {account}</p>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-text-dim">Worker address</label>
            <input
              value={workerAddress}
              onChange={(e) => setWorkerAddress(e.target.value)}
              placeholder="0x..."
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm font-mono outline-none focus:border-teal/50"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-text-dim">Amount (USDC)</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm font-mono outline-none focus:border-teal/50 w-32"
            />
          </div>
          <button
            onClick={sponsor}
            disabled={phase === "sending"}
            className="self-start rounded-lg bg-teal/15 border border-teal/30 text-teal px-4 py-2 text-sm font-medium hover:bg-teal/25 transition-colors disabled:opacity-50"
          >
            {phase === "sending" ? "Sending…" : "Send starter grant"}
          </button>
        </>
      )}

      {txHash && (
        <p className="text-xs text-teal">
          Sent —{" "}
          <a href={explorerTx(txHash)} target="_blank" rel="noreferrer" className="underline">
            view on ArcScan ↗
          </a>
        </p>
      )}
      {error && <p className="text-xs text-red">{error}</p>}
    </div>
  );
}

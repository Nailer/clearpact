"use client";

import { useEffect, useState } from "react";
import { fetchFlatJobs, fetchMilestoneJobs, fetchAgents } from "@/lib/data";
import { formatUsdc } from "@/lib/config";

function useCountUp(target: number, decimals = 0, durationMs = 1200) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (target === 0) return;
    const start = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value.toFixed(decimals);
}

function Stat({ label, target, decimals, suffix }: { label: string; target: number; decimals?: number; suffix?: string }) {
  const display = useCountUp(target, decimals);
  return (
    <div className="text-center">
      <div className="text-3xl md:text-4xl font-medium text-teal tabular-nums">
        {display}
        {suffix}
      </div>
      <div className="text-xs text-text-dim mt-1 uppercase tracking-wide">{label}</div>
    </div>
  );
}

/** Real numbers, pulled live from Arc testnet on mount — the landing page's
 *  proof that this is a working product, not a mockup. */
export function LiveStats() {
  const [jobs, setJobs] = useState(0);
  const [usdc, setUsdc] = useState(0);
  const [agents, setAgents] = useState(0);
  const [topRep, setTopRep] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [flat, milestones] = await Promise.all([fetchFlatJobs(), fetchMilestoneJobs()]);
        const agentStats = await fetchAgents(flat, milestones);
        if (cancelled) return;
        const total =
          flat.reduce((s, j) => s + j.amount, 0n) +
          milestones.reduce((s, j) => s + j.milestones.reduce((ms, m) => ms + m.amount, 0n), 0n);
        setJobs(flat.length + milestones.length);
        setUsdc(Number(formatUsdc(total)));
        setAgents(agentStats.length);
        setTopRep(Math.max(0, ...agentStats.map((a) => a.reputationScore)));
      } catch {
        // Landing page proof strip is best-effort — a stale RPC shouldn't block the hero.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">
      <Stat label="USDC escrowed" target={usdc} decimals={2} />
      <Stat label="Jobs settled on-chain" target={jobs} />
      <Stat label="Agents with a credit score" target={agents} />
      <Stat label="Top reputation" target={topRep} suffix="/100" />
    </div>
  );
}

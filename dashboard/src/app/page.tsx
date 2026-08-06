"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchFlatJobs, fetchMilestoneJobs, fetchAgents, fetchActivity } from "@/lib/data";
import type { FlatJob, MilestoneJob, AgentStats, ActivityEvent } from "@/lib/data";
import { formatUsdc, CONTRACTS, explorerAddress } from "@/lib/config";
import { StatCard } from "@/components/StatCard";
import { JobsTable } from "@/components/JobsTable";
import { Leaderboard } from "@/components/Leaderboard";
import { ActivityFeed } from "@/components/ActivityFeed";
import { SponsorPanel } from "@/components/SponsorPanel";

const POLL_MS = 15_000;

export default function Home() {
  const [flatJobs, setFlatJobs] = useState<FlatJob[]>([]);
  const [milestoneJobs, setMilestoneJobs] = useState<MilestoneJob[]>([]);
  const [agents, setAgents] = useState<AgentStats[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [flat, milestones, events] = await Promise.all([fetchFlatJobs(), fetchMilestoneJobs(), fetchActivity()]);
      const agentStats = await fetchAgents(flat, milestones);
      setFlatJobs(flat);
      setMilestoneJobs(milestones);
      setAgents(agentStats);
      setActivity(events);
      setLastUpdated(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const totalEscrowed =
    flatJobs.reduce((s, j) => s + j.amount, 0n) +
    milestoneJobs.reduce((s, j) => s + j.milestones.reduce((ms, m) => ms + m.amount, 0n), 0n);
  const totalReleased =
    flatJobs.filter((j) => j.status === 5).reduce((s, j) => s + j.amount, 0n) +
    milestoneJobs.reduce((s, j) => s + j.milestones.filter((m) => m.status === 5).reduce((ms, m) => ms + m.amount, 0n), 0n);
  const activeJobs =
    flatJobs.filter((j) => j.status >= 1 && j.status <= 4).length +
    milestoneJobs.filter((j) => j.milestones.some((m) => m.status >= 1 && m.status <= 4)).length;
  const disputedCount = activity.filter((e) => e.eventName === "JobDisputed" || e.eventName === "MilestoneDisputed").length;

  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b border-border bg-surface/50">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg width="28" height="28" viewBox="0 0 200 224" className="shrink-0">
              <polygon points="100,20 150,50 150,110 100,140 50,110 50,50" fill="#14304D" />
              <path d="M80,72 L94,88 L124,54" fill="none" stroke="#22c08c" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div>
              <h1 className="text-base font-medium">ClearPact</h1>
              <p className="text-xs text-text-dim">live on Arc testnet</p>
            </div>
          </div>
          <div className="text-right text-xs text-text-dim">
            {loading ? "loading…" : lastUpdated ? `updated ${lastUpdated.toLocaleTimeString()}` : ""}
            <div className="flex items-center gap-1.5 justify-end mt-0.5">
              <span className="h-1.5 w-1.5 rounded-full bg-teal animate-pulse" />
              refreshing every 15s
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto max-w-6xl w-full px-6 py-8 flex flex-col gap-8">
        {error && (
          <div className="rounded-lg border border-red/30 bg-red/10 px-4 py-3 text-sm text-red">
            Failed to load on-chain data: {error}
          </div>
        )}

        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total escrowed" value={`${formatUsdc(totalEscrowed)} USDC`} sub="all jobs, all time" />
          <StatCard label="Released to workers" value={`${formatUsdc(totalReleased)} USDC`} sub="verified & paid" accent="teal" />
          <StatCard label="Active jobs" value={String(activeJobs)} sub={`${flatJobs.length + milestoneJobs.length} total ever`} />
          <StatCard
            label="Disputes"
            value={String(disputedCount)}
            sub="caught & arbitrated"
            accent={disputedCount > 0 ? "red" : undefined}
          />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-text-dim uppercase tracking-wide">Agent reputation</h2>
          <Leaderboard agents={agents} />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-text-dim uppercase tracking-wide">Jobs</h2>
          <JobsTable flatJobs={flatJobs} milestoneJobs={milestoneJobs} />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-text-dim uppercase tracking-wide">Live activity</h2>
          <ActivityFeed events={activity} />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-text-dim uppercase tracking-wide">App Kit</h2>
          <SponsorPanel />
        </section>

        <footer className="text-xs text-text-dim border-t border-border pt-4 flex flex-wrap gap-x-6 gap-y-1">
          <a href={explorerAddress(CONTRACTS.escrow)} target="_blank" rel="noreferrer" className="hover:text-teal">
            ClearPactEscrow ↗
          </a>
          <a href={explorerAddress(CONTRACTS.milestoneEscrow)} target="_blank" rel="noreferrer" className="hover:text-teal">
            MilestoneEscrow ↗
          </a>
          <a href={explorerAddress(CONTRACTS.registry)} target="_blank" rel="noreferrer" className="hover:text-teal">
            ReputationRegistry ↗
          </a>
        </footer>
      </main>
    </div>
  );
}

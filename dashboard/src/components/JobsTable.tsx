"use client";

import { Fragment, useState } from "react";
import type { FlatJob, MilestoneJob } from "@/lib/data";
import { explorerAddress, formatUsdc, shortAddr } from "@/lib/config";
import { StatusBadge } from "./StatusBadge";

function AddrLink({ address }: { address: string }) {
  return (
    <a
      href={explorerAddress(address)}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-xs text-text-dim hover:text-teal transition-colors"
    >
      {shortAddr(address)}
    </a>
  );
}

export function JobsTable({ flatJobs, milestoneJobs }: { flatJobs: FlatJob[]; milestoneJobs: MilestoneJob[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const allJobs = [...flatJobs, ...milestoneJobs].sort((a, b) => b.jobId - a.jobId);

  if (allJobs.length === 0) {
    return <div className="rounded-xl border border-border bg-surface p-6 text-sm text-text-dim">No jobs yet.</div>;
  }

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-dim">
            <th className="px-4 py-3 font-medium">Job</th>
            <th className="px-4 py-3 font-medium">Type</th>
            <th className="px-4 py-3 font-medium">Buyer</th>
            <th className="px-4 py-3 font-medium">Worker</th>
            <th className="px-4 py-3 font-medium">Amount</th>
            <th className="px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {allJobs.map((job) => {
            const isMilestone = job.kind === "milestone";
            const total = isMilestone
              ? (job as MilestoneJob).milestones.reduce((s, m) => s + m.amount, 0n)
              : (job as FlatJob).amount;
            const isOpen = expanded === job.jobId && isMilestone;
            return (
              <Fragment key={`${job.kind}-${job.jobId}`}>
                <tr
                  className={`border-b border-border last:border-0 ${isMilestone ? "cursor-pointer hover:bg-surface-2" : ""}`}
                  onClick={() => isMilestone && setExpanded(isOpen ? null : job.jobId)}
                >
                  <td className="px-4 py-3 font-mono">#{job.jobId}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-text-dim">{isMilestone ? "Milestone ×3" : "Single-payment"}</span>
                  </td>
                  <td className="px-4 py-3">
                    <AddrLink address={job.buyer} />
                  </td>
                  <td className="px-4 py-3">
                    <AddrLink address={job.worker} />
                  </td>
                  <td className="px-4 py-3 font-mono">{formatUsdc(total)} USDC</td>
                  <td className="px-4 py-3">
                    {isMilestone ? (
                      <span className="text-xs text-text-dim">
                        {(job as MilestoneJob).milestones.filter((m) => m.status === 5).length}/
                        {(job as MilestoneJob).milestones.length} released
                      </span>
                    ) : (
                      <StatusBadge status={(job as FlatJob).status} />
                    )}
                  </td>
                </tr>
                {isOpen &&
                  (job as MilestoneJob).milestones.map((m) => (
                    <tr key={`m-${job.jobId}-${m.index}`} className="border-b border-border last:border-0 bg-surface-2/50">
                      <td className="px-4 py-2 pl-8 text-xs text-text-dim" colSpan={4}>
                        Milestone {m.index}
                        {m.score > 0 && <span className="ml-2 text-teal">score {m.score}/100</span>}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">{formatUsdc(m.amount)} USDC</td>
                      <td className="px-4 py-2">
                        <StatusBadge status={m.status} />
                      </td>
                    </tr>
                  ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

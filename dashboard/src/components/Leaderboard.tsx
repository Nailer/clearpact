import type { AgentStats } from "@/lib/data";
import { explorerAddress, formatUsdc, shortAddr } from "@/lib/config";

function repColor(score: number): string {
  if (score >= 70) return "text-teal";
  if (score >= 40) return "text-amber";
  return "text-red";
}

export function Leaderboard({ agents }: { agents: AgentStats[] }) {
  const sorted = [...agents].sort((a, b) => b.reputationScore - a.reputationScore);

  if (sorted.length === 0) {
    return <div className="rounded-xl border border-border bg-surface p-6 text-sm text-text-dim">No agents yet.</div>;
  }

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-dim">
            <th className="px-4 py-3 font-medium">Agent</th>
            <th className="px-4 py-3 font-medium">Reputation</th>
            <th className="px-4 py-3 font-medium">Delivered</th>
            <th className="px-4 py-3 font-medium">Pass rate</th>
            <th className="px-4 py-3 font-medium">Disputes lost</th>
            <th className="px-4 py-3 font-medium">Bond (free / locked)</th>
            <th className="px-4 py-3 font-medium">Lifetime earned</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((a) => (
            <tr key={a.address} className="border-b border-border last:border-0">
              <td className="px-4 py-3">
                <a
                  href={explorerAddress(a.address)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-text-dim hover:text-teal transition-colors"
                >
                  {shortAddr(a.address)}
                </a>
              </td>
              <td className={`px-4 py-3 font-medium ${repColor(a.reputationScore)}`}>{a.reputationScore}/100</td>
              <td className="px-4 py-3 text-text-dim">{a.jobsDelivered}</td>
              <td className="px-4 py-3 text-text-dim">
                {a.jobsDelivered > 0 ? Math.round((a.jobsPassed / a.jobsDelivered) * 100) : 0}%
              </td>
              <td className="px-4 py-3">
                {a.disputesLost > 0 ? <span className="text-red">{a.disputesLost}</span> : <span className="text-text-dim">0</span>}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-text-dim">
                {formatUsdc(a.freeStake)} / {formatUsdc(a.lockedStake)}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-teal">{formatUsdc(a.totalEarned)} USDC</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

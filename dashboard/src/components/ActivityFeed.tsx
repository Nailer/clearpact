import type { ActivityEvent } from "@/lib/data";
import { explorerTx, formatUsdc, shortAddr } from "@/lib/config";

function describe(e: ActivityEvent): string {
  const a = e.args;
  switch (e.eventName) {
    case "JobCreated":
      return `Job #${a.jobId} created — ${formatUsdc((a.amount ?? a.totalAmount) as bigint)} USDC escrowed by ${shortAddr(a.buyer as string)}`;
    case "WorkDelivered":
    case "MilestoneDelivered":
      return `Job #${a.jobId}${a.milestoneIndex !== undefined ? ` (milestone ${a.milestoneIndex})` : ""} delivered`;
    case "VerdictSubmitted":
    case "MilestoneVerdict":
      return `Job #${a.jobId}${a.milestoneIndex !== undefined ? ` (milestone ${a.milestoneIndex})` : ""} graded ${a.score}/100 — ${a.passed ? "passed" : "failed"}`;
    case "JobReleased":
    case "MilestoneReleased":
      return `${formatUsdc(a.amount as bigint)} USDC released to worker on job #${a.jobId}`;
    case "JobRefunded":
    case "MilestoneRefunded":
      return `${formatUsdc(a.amount as bigint)} USDC refunded to buyer on job #${a.jobId}`;
    case "JobDisputed":
    case "MilestoneDisputed":
      return `Job #${a.jobId} disputed by ${shortAddr(a.by as string)}`;
    case "JobArbitrated":
    case "MilestoneArbitrated":
      return `Job #${a.jobId} arbitrated — ${formatUsdc(a.workerAmount as bigint)} to worker, ${formatUsdc(a.buyerAmount as bigint)} to buyer${
        (a.slashedAmount as bigint) > 0n ? `, ${formatUsdc(a.slashedAmount as bigint)} slashed` : ""
      }`;
    case "Staked":
      return `${shortAddr(a.agent as string)} staked ${formatUsdc(a.amount as bigint)} USDC bond`;
    case "Slashed":
      return `${shortAddr(a.agent as string)} slashed ${formatUsdc(a.amount as bigint)} USDC`;
    case "JobCompleted":
      return `Job #${a.jobId} fully completed — bond released`;
    default:
      return e.eventName;
  }
}

const DOT_COLOR: Record<string, string> = {
  JobCreated: "bg-text-dim",
  JobReleased: "bg-teal",
  MilestoneReleased: "bg-teal",
  JobRefunded: "bg-amber",
  MilestoneRefunded: "bg-amber",
  JobDisputed: "bg-red",
  MilestoneDisputed: "bg-red",
  JobArbitrated: "bg-red",
  MilestoneArbitrated: "bg-red",
  Slashed: "bg-red",
  Staked: "bg-teal",
};

export function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) {
    return <div className="rounded-xl border border-border bg-surface p-6 text-sm text-text-dim">No activity yet.</div>;
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4 flex flex-col gap-3 max-h-[480px] overflow-y-auto">
      {events.slice(0, 40).map((e, i) => (
        <div key={`${e.txHash}-${i}`} className="flex items-start gap-3 text-sm">
          <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${DOT_COLOR[e.eventName] ?? "bg-text-dim"}`} />
          <div className="flex-1">
            <p className="text-text">{describe(e)}</p>
            <a
              href={explorerTx(e.txHash)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs text-text-dim hover:text-teal transition-colors"
            >
              block {e.blockNumber.toString()} · {shortAddr(e.txHash)}
            </a>
          </div>
        </div>
      ))}
    </div>
  );
}

import { STATUS_LABELS } from "@/lib/data";

const COLORS: Record<string, string> = {
  Created: "bg-surface-2 text-text-dim border-border",
  Delivered: "bg-amber/10 text-amber border-amber/30",
  Verified: "bg-teal/10 text-teal border-teal/30",
  Disputed: "bg-red/10 text-red border-red/30",
  Released: "bg-teal/15 text-teal border-teal/40",
  Refunded: "bg-surface-2 text-text-dim border-border",
  Resolved: "bg-surface-2 text-text-dim border-border",
};

export function StatusBadge({ status }: { status: number }) {
  const label = STATUS_LABELS[status] ?? "Unknown";
  const cls = COLORS[label] ?? COLORS.Created;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

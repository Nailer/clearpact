export function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "teal" | "amber" | "red";
}) {
  const accentColor = accent === "teal" ? "text-teal" : accent === "amber" ? "text-amber" : accent === "red" ? "text-red" : "text-text";
  return (
    <div className="rounded-xl border border-border bg-surface p-4 flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-text-dim">{label}</span>
      <span className={`text-2xl font-medium ${accentColor}`}>{value}</span>
      {sub && <span className="text-xs text-text-dim">{sub}</span>}
    </div>
  );
}

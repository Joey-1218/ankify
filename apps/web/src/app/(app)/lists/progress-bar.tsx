import { cn } from "@/lib/utils";

/** Learned (solid) and started (soft) shares of a list's distinct problems. */
export function ProgressBar({
  label,
  valueText,
  learned,
  started,
  total,
  className,
}: {
  /** The accessible name: what this is the progress of. */
  label: string;
  valueText: string;
  learned: number;
  started: number;
  total: number;
  className?: string;
}) {
  const percent = (value: number) => (total > 0 ? Math.min(100, (value / total) * 100) : 0);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuetext={valueText}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={learned}
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-subtle", className)}
    >
      <div className="absolute inset-y-0 left-0 bg-accent-soft" style={{ width: `${percent(started)}%` }} />
      <div className="absolute inset-y-0 left-0 bg-accent-solid" style={{ width: `${percent(learned)}%` }} />
    </div>
  );
}

import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-surface p-5",
        className,
      )}
    >
      <div className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="font-mono text-3xl font-bold leading-none">{value}</div>
      {hint && (
        <div className="mt-2 font-mono text-[10px] text-muted-foreground">
          {hint}
        </div>
      )}
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-4 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
      {children}
    </h2>
  );
}

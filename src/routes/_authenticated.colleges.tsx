import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { Building2, Users, Trophy } from "lucide-react";

import { listColleges } from "@/lib/colleges.functions";
import { StatCard, SectionTitle } from "@/components/stat-card";
import { AnimatedLoader } from "@/components/animated-loader";
import { ReportExportDialog } from "@/components/report-export-dialog";
import { Button } from "@/components/ui/button";

const collegesQO = () => queryOptions({ queryKey: ["colleges"], queryFn: () => listColleges() });

export const Route = createFileRoute("/_authenticated/colleges")({
  head: () => ({ meta: [{ title: "Colleges — Almanac" }] }),
  loader: ({ context }) => {
    // Client-only: attachSupabaseAuth is a CLIENT middleware, so an SSR loader
    // would send no bearer token and the scoping would resolve to nobody.
    if (typeof window !== "undefined") return context.queryClient.ensureQueryData(collegesQO());
  },
  component: CollegesPage,
  pendingComponent: () => <AnimatedLoader text="Loading colleges…" />,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-destructive">{error.message}</div>
  ),
});

function num(n: number) {
  return n.toLocaleString();
}

function CollegesPage() {
  const { colleges, combined, scope } = useSuspenseQuery(collegesQO()).data;
  const [exportOpen, setExportOpen] = useState(false);

  if (colleges.length === 0) {
    return (
      <div className="p-8">
        <SectionTitle>Colleges</SectionTitle>
        <p className="mt-2 text-sm text-muted-foreground">
          No colleges are assigned to you yet. Ask an admin to add you to one.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8">
      <ReportExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        preselectCollegeIds={colleges.map((c) => c.college_id)}
      />

      <div className="mb-6 flex items-baseline justify-between gap-4">
        <div>
          <SectionTitle>Colleges</SectionTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {scope === "all"
              ? "Every college on Almanac."
              : `The ${colleges.length} college${colleges.length === 1 ? "" : "s"} assigned to you.`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
          Export report
        </Button>
      </div>

      {/* Combined first: the "all my colleges" view. These totals are summed from
          exactly the rows below, never from a wider query — a CEO's overall
          figure must not silently include an institution they cannot open. */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard
          label="Colleges"
          value={
            <span className="inline-flex items-center gap-1">
              <Building2 className="size-5 text-primary" />
              {combined.colleges}
            </span>
          }
          hint={scope === "all" ? "platform-wide" : "assigned to you"}
        />
        <StatCard label="Students" value={num(combined.student_count)} hint="across all of them" />
        <StatCard label="Classrooms" value={num(combined.classroom_count)} />
        <StatCard label="Problems Solved" value={num(combined.total_solved)} hint="all platforms" />
        <StatCard
          label="Avg Almanac Score"
          value={num(Math.round(combined.avg_score))}
          // Student-weighted, not a mean of per-college means: a 500-student
          // campus and a 12-student one must not count equally.
          hint="weighted by student count"
        />
      </div>

      <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Per college
      </h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {colleges
          .slice()
          .sort((a, b) => b.avg_score - a.avg_score)
          .map((c, i) => (
            <div
              key={c.college_id}
              className="rounded-lg border border-border bg-surface p-5 transition-colors hover:border-primary/50"
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-base font-bold">{c.college_name}</div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    {c.college_slug}
                  </div>
                </div>
                {colleges.length > 1 && (
                  <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                    #{i + 1}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Metric
                  icon={<Users className="size-3.5" />}
                  label="Students"
                  value={num(c.student_count)}
                />
                <Metric label="Classrooms" value={num(c.classroom_count)} />
                <Metric
                  icon={<Trophy className="size-3.5 text-primary" />}
                  label="Avg score"
                  value={num(Math.round(c.avg_score))}
                />
                <Metric label="Solved" value={num(c.total_solved)} />
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {c.platforms_in_use} platform{c.platforms_in_use === 1 ? "" : "s"} in use
                </span>
                <Link
                  to="/classrooms"
                  className="font-mono text-[10px] uppercase tracking-widest text-primary hover:underline"
                >
                  Classrooms →
                </Link>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="font-bold">{value}</div>
    </div>
  );
}

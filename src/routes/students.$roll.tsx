import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, ExternalLink, RefreshCw, MapPin, Trophy, EyeOff, Pencil } from "lucide-react";

import { getStudentByRoll, refreshStudent, updateStudent } from "@/lib/students.functions";
import { Button } from "@/components/ui/button";
import { EditStudentModal } from "@/components/edit-student-modal";
import { useRole } from "@/hooks/use-role";
import { PlatformStrip } from "@/components/platform-strip";
import { PlatformDetail } from "@/components/platform-detail";
import { panelFor } from "@/components/platform/registry";
import { UnavailablePanel } from "@/components/platform/panel-kit";
import { platformStatus } from "@/lib/platform-capabilities";
import { StatCard } from "@/components/stat-card";
import { cn } from "@/lib/utils";
import { AnimatedLoader } from "@/components/animated-loader";

const studentQO = (roll: string) =>
  queryOptions({
    queryKey: ["student", roll],
    queryFn: () => getStudentByRoll({ data: { roll } }),
  });

function PendingStudent() {
  return <AnimatedLoader text="Loading student…" />;
}

export const Route = createFileRoute("/students/$roll")({
  head: () => ({ meta: [{ title: "Student — Almanac" }] }),
  loader: ({ params, context }) => {
    if (typeof window !== "undefined") {
      return context.queryClient.ensureQueryData(studentQO(params.roll));
    }
  },
  component: StudentPage,
  pendingComponent: PendingStudent,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-destructive">{error.message}</div>
  ),
  notFoundComponent: () => <div className="p-8 text-sm">Student not found.</div>,
});

function StudentPage() {
  const { roll } = Route.useParams();
  const { data } = useSuspenseQuery(studentQO(roll));
  // Which platform's deep-dive is showing. Defaults to LeetCode when present so
  // the page opens on the view it always had.
  const [tab, setTab] = useState<string>("leetcode");
  const { student, stats, classrooms, ranks, masked, platforms } = data;
  const router = useRouter();
  const qc = useQueryClient();

  const refresh = useServerFn(refreshStudent);
  const refreshM = useMutation({
    mutationFn: () => refresh({ data: { id: student.id } }),
    onSuccess: () => {
      toast.success("Refreshed");
      // Invalidate every cache that renders scraped data so the fresh numbers
      // propagate to classroom tables, overview, rankings, etc. — not just the
      // current route's loader.
      qc.invalidateQueries({ queryKey: ["classroom"] });
      qc.invalidateQueries({ queryKey: ["classrooms"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["student", roll] });
      qc.invalidateQueries({ queryKey: ["rankings"] });
      qc.invalidateQueries({ queryKey: ["colleges"] });
      qc.invalidateQueries({ queryKey: ["cohort-performance"] });
      qc.invalidateQueries({ queryKey: ["performance-windows"] });
      qc.invalidateQueries({ queryKey: ["matrix-breakdown"] });
      router.invalidate();
    },
    onError: (e) => toast.error(String(e)),
  });

  /*
    Editing from the profile, not just from a cohort roster.

    Faculty reach students through search and through this page far more often
    than through the classroom table, and until now fixing a typo'd handle meant
    finding the student's cohort first. The server gates this the same way it
    always did (canManageStudents, plus assertStudentAccess), so the button
    simply follows the permission rather than adding one.

    Cohort transfer is deliberately not offered here — moving a student needs
    the cohort you are moving OUT of, which this page has no single answer for.
  */
  const { canManageStudents, canAdminister } = useRole();
  const [editing, setEditing] = useState<{
    id: string;
    name: string;
    roll: string;
    email: string;
    leetcode_id: string;
  } | null>(null);

  const updateStu = useServerFn(updateStudent);
  const editM = useMutation({
    mutationFn: (s: NonNullable<typeof editing> & { handles?: Record<string, string> }) =>
      updateStu({
        data: {
          id: s.id,
          name: s.name,
          roll: s.roll,
          email: s.email || null,
          leetcode_id: s.leetcode_id,
          handles: s.handles,
        },
      }),
    onSuccess: (_r, s) => {
      toast.success("Student updated");
      setEditing(null);

      // Propagate the edit to every cache that could show this student's data.
      qc.invalidateQueries({ queryKey: ["classroom"] });
      qc.invalidateQueries({ queryKey: ["classrooms"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["rankings"] });
      qc.invalidateQueries({ queryKey: ["search"] });
      qc.invalidateQueries({ queryKey: ["colleges"] });
      qc.invalidateQueries({ queryKey: ["student-handles", s.id] });

      // The roll is the route param, so a changed roll has to navigate rather
      // than refetch — the old URL no longer resolves to anyone.
      // Invalidate BOTH old and new roll queries so neither shows stale data.
      qc.invalidateQueries({ queryKey: ["student", roll] });
      if (s.roll !== roll) {
        qc.invalidateQueries({ queryKey: ["student", s.roll] });
        router.navigate({ to: "/students/$roll", params: { roll: s.roll } });
      } else {
        router.invalidate();
      }
    },
    onError: (e) => toast.error(String(e)),
  });

  const err = student.scrape_error;

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <button
        onClick={() => router.history.back()}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back
      </button>
      {/* Row 1: Sticky header card */}
      <div className="mb-6 rounded-lg border border-border bg-surface p-6">
        <div className="flex flex-wrap items-start gap-6">
          {stats?.avatar ? (
            <img
              src={stats.avatar}
              alt=""
              className="size-20 rounded-lg bg-muted object-cover ring-1 ring-white/10"
              onError={(e) => (e.currentTarget.style.display = "none")}
            />
          ) : (
            <div className="grid size-20 place-items-center rounded-lg bg-muted font-mono text-2xl font-bold">
              {student.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight">{student.name}</h1>
              <span className="rounded bg-primary/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-primary">
                {student.roll}
              </span>
              {/* A student can be in several cohorts. Empty when masked — the
                  membership list is itself identifying. */}
              {classrooms.slice(0, 3).map((c) => (
                <span
                  key={c.id}
                  className="rounded bg-accent px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-accent-foreground"
                >
                  {c.name}
                </span>
              ))}
              {classrooms.length > 3 && (
                <span
                  className="rounded bg-accent px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-muted-foreground"
                  title={classrooms.map((c) => c.name).join(" · ")}
                >
                  +{classrooms.length - 3}
                </span>
              )}
              {stats?.contest_top_percentage != null && stats.contest_top_percentage < 5 && (
                <span className="rounded bg-primary/20 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-primary ring-1 ring-primary/30">
                  ELITE
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              {masked ? (
                // No outbound link here: its href would hand back the very handle
                // the masking is withholding.
                <span className="font-mono">@{student.leetcode_id}</span>
              ) : (
                <a
                  href={`https://leetcode.com/u/${student.leetcode_id}/`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  @{student.leetcode_id} <ExternalLink className="size-3" />
                </a>
              )}
              {student.email && <span className="font-mono">· {student.email}</span>}
              {stats?.real_name && <span>· {stats.real_name}</span>}
              {stats?.country && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3" />
                  {stats.country}
                </span>
              )}
            </div>
            {student.last_scraped_at && (
              <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                Last scraped {new Date(student.last_scraped_at).toLocaleString()}
              </p>
            )}
          </div>
          {/* The Refresh button used to render for anonymous visitors too, where it
              could only ever return Unauthorized. */}
          {!masked && canManageStudents && (
            <div className="flex shrink-0 gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  setEditing({
                    id: student.id,
                    name: student.name,
                    roll: student.roll,
                    email: student.email ?? "",
                    leetcode_id: student.leetcode_id,
                  })
                }
              >
                <Pencil className="mr-1 size-4" />
                Edit
              </Button>
              <Button
                variant="outline"
                onClick={() => refreshM.mutate()}
                disabled={refreshM.isPending}
              >
                <RefreshCw className={cn("mr-1 size-4", refreshM.isPending && "animate-spin")} />
                Refresh
              </Button>
            </div>
          )}
        </div>
      </div>

      {masked && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-border bg-surface p-4 text-sm">
          <EyeOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">
            Personal details are partially hidden on the public view. All LeetCode progress below is
            complete.{" "}
            <span className="text-foreground">Staff can sign in to see full details.</span>
          </p>
        </div>
      )}

      {err && (
        <div className="mb-6 rounded-lg border border-hard/40 bg-hard/10 p-4 text-sm">
          <strong className="text-hard">Scrape error:</strong> {err}
        </div>
      )}

      {/*
        Three ranks, ordered nearest-first: their cohort, then the college, then
        LeetCode's worldwide number. Shown to anonymous visitors too — every one is
        derived from problems solved, which this page already publishes in full
        because it is public on leetcode.com anyway.

        Per-cohort ranks are the exception and the server withholds them from a
        masked viewer: each carries a classroom NAME, and cohort membership is
        precisely what masking exists to hide.
      */}
      {/* Every platform at a glance, before any single-platform detail. A student
          on five sites should not have to infer their spread from a LeetCode
          donut. */}
      <PlatformStrip platforms={platforms} masked={masked} />

      {ranks && ranks.classroom_ranks.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {ranks.classroom_ranks.map((cr) => (
            <StatCard
              key={cr.classroom_id}
              label={`Rank in ${cr.classroom_name}`}
              value={
                <span className="inline-flex items-center gap-1">
                  <Trophy className="size-5 text-primary" />#{cr.rank}
                </span>
              }
              hint={`of ${cr.total} in this cohort`}
            />
          ))}
        </div>
      )}

      {/*
        Row 2: KPI tiles.

        The first two are cross-platform and stay put. The rest FOLLOW THE
        SELECTED PLATFORM — they used to be hardcoded to student_stats, so
        switching to Codeforces changed the panel at the bottom of the page while
        "Total Solved", "World Rank", "Streak" and "Contest Rating" above it went
        on quoting LeetCode. The page said Codeforces and showed LeetCode.
      */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Almanac Score"
          value={ranks ? Math.round(ranks.almanac_score).toLocaleString() : "—"}
          hint={
            ranks?.college_name
              ? `#${ranks.college_rank} in ${ranks.college_name}`
              : "difficulty-weighted, all platforms"
          }
        />
        <StatCard
          label="College"
          value={
            ranks?.college_name ? (
              <span className="text-xl leading-tight">{ranks.college_name}</span>
            ) : (
              "—"
            )
          }
          /* A student has no college column — student_colleges resolves it from
             their EARLIEST classroom membership. That inheritance was invisible,
             so a student ranked under a college nobody expected had no
             explanation on the page. */
          hint="from earliest cohort"
        />
        <StatCard
          label="College Rank"
          value={
            ranks?.college_rank ? (
              <span className="inline-flex items-center gap-1">
                <Trophy className="size-5 text-primary" />#{ranks.college_rank}
              </span>
            ) : (
              "—"
            )
          }
          hint={
            ranks?.college_total
              ? `of ${ranks.college_total}${ranks.overall_total > ranks.college_total ? ` · #${ranks.overall_rank} of ${ranks.overall_total} overall` : ""}`
              : undefined
          }
        />
      </div>

      {/* Platform switcher.
          Only the connected platforms appear — a tab for a site the student has
          no account on is a dead end. LeetCode keeps its bespoke layout because
          it publishes far more than anything else; everything else shares one
          generic panel driven by whatever that platform actually returns. */}
      {platforms.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-1.5 border-b border-border pb-2">
          {platforms.map((pl) => (
            <button
              key={pl.platform_id}
              type="button"
              onClick={() => setTab(pl.platform_id)}
              className={
                tab === pl.platform_id
                  ? "rounded-md bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary"
                  : "rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              }
            >
              {pl.name}
            </button>
          ))}
        </div>
      )}

      {/*
        One panel per platform, each speaking that platform's own language.
        A platform with no adapter never gets a panel — it gets a state that
        says so, because "nothing fetched yet" implies a fetch is coming.
      */}
      {(() => {
        const sel = platforms.find((pl) => pl.platform_id === tab);
        if (!sel) return null;

        const status = platformStatus(sel.platform_id, sel.enabled);
        if (status === "no_adapter" || status === "blocked" || status === "excluded") {
          return (
            <UnavailablePanel
              name={sel.name}
              platformId={sel.platform_id}
              status={status}
              handle={sel.handle}
            />
          );
        }

        const Panel = panelFor(sel.platform_id);
        return Panel ? <Panel p={sel} stats={stats} /> : <PlatformDetail p={sel} />;
      })()}

      {/* No cohort-transfer props: this page has no single "move out of" cohort,
          so that section stays hidden here. */}
      {editing && (
        <EditStudentModal
          student={editing}
          shared={classrooms.length > 1}
          canAdminister={canAdminister}
          onChange={setEditing}
          onSave={(handles) => editM.mutate({ ...editing, handles })}
          onClose={() => setEditing(null)}
          isPending={editM.isPending}
        />
      )}
    </div>
  );
}

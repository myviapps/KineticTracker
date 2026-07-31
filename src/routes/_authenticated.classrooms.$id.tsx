import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, LineChart, Line, CartesianGrid,
} from "recharts";
import { Plus, Trash2, ExternalLink, Search, ArrowUpDown, Download, Pencil, X, UserMinus, Users2, TriangleAlert } from "lucide-react";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
  AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";

import { getClassroom, deleteClassroom, updateClassroom } from "@/lib/classrooms.functions";
import { updateStudent, removeStudentFromClassroom } from "@/lib/students.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatCard, SectionTitle } from "@/components/stat-card";
import { toStudentRow, filterBucket, bucketCounts, BUCKETS, type BucketId } from "@/lib/buckets";
import { LeaderboardBars } from "@/components/leaderboard-bars";
import { TopNControl } from "@/components/top-n-control";
import { DailyMatrix } from "@/components/daily-matrix";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useCssVars } from "@/hooks/use-css-vars";
import { CHART_MOTION, CHART_MOTION_STATIC } from "@/lib/chart-motion";
import { RefreshButton } from "@/components/refresh-button";
import { useRole } from "@/hooks/use-role";
import { useRefreshJobStatus } from "@/hooks/use-refresh-job";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AnimatedLoader } from "@/components/animated-loader";
import { useDuplicates } from "@/components/duplicates";

const clsQO = (id: string) =>
  queryOptions({
    queryKey: ["classroom", id],
    queryFn: () => getClassroom({ data: { id } }),
  });

function PendingClassroom() {
  return <AnimatedLoader text="Loading classroom…" />;
}

export const Route = createFileRoute("/_authenticated/classrooms/$id")({
  head: () => ({ meta: [{ title: "Classroom — Almanac" }] }),
  loader: ({ params, context }) => {
    if (typeof window !== "undefined") {
      return context.queryClient.ensureQueryData(clsQO(params.id));
    }
  },
  component: ClassroomDetail,
  pendingComponent: PendingClassroom,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-destructive">{error.message}</div>
  ),
  notFoundComponent: () => <div className="p-8 text-sm">Classroom not found.</div>,
});

type SortKey =
  | "name" | "roll" | "total" | "easy" | "medium" | "hard"
  | "today" | "yesterday" | "week" | "month" | "streak"
  | "classRank" | "collegeRank" | "lcRank";

function ClassroomDetail() {
  const { id } = Route.useParams();
  const { data } = useSuspenseQuery(clsQO(id));
  const router = useRouter();
  // Every mutating control below used to render for all roles, including
  // placement officers, whom the server treats as read-only.
  const { canManageStudents, canAdminister, isLoading: roleLoading } = useRole();
  // While a refresh job is advancing, the pump invalidates these queries every few
  // seconds. Replaying the draw-in animation on that cadence reads as flicker, so
  // charts update in place instead.
  const { job } = useRefreshJobStatus();
  const chartMotion =
    job && (job.status === "running" || job.status === "queued")
      ? CHART_MOTION_STATIC
      : CHART_MOTION;
  const [search, setSearch] = useState("");
  const [bucket, setBucket] = useState<BucketId>("all");
  const [tab, setTab] = useState<"report" | "matrix">("report");
  const searchRef = useRef<HTMLInputElement>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "total",
    dir: "desc",
  });
  const [editingStudent, setEditingStudent] = useState<{
    id: string; name: string; roll: string; email: string; leetcode_id: string;
  } | null>(null);
  const [hideScrapingStatus, setHideScrapingStatus] = useState(false);

  const updateStu = useServerFn(updateStudent);
  const editM = useMutation({
    mutationFn: (s: { id: string; name: string; roll: string; email: string; leetcode_id: string }) =>
      updateStu({ data: { id: s.id, name: s.name, roll: s.roll, email: s.email || null, leetcode_id: s.leetcode_id } }),
    onSuccess: (_data, s) => {
      toast.success("Student updated");
      setEditingStudent(null);
      qc.invalidateQueries({ queryKey: ["classroom", id] });
      qc.invalidateQueries({ queryKey: ["student", s.roll] });
    },
    onError: (e) => toast.error(String(e)),
  });

  const qc = useQueryClient();
  const del = useServerFn(deleteClassroom);
  const delM = useMutation({
    mutationFn: () => del({ data: { id } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["classrooms"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      // Reporting both numbers is the cheapest safety net against a mis-scoped
      // delete — you find out immediately if it took more than you expected.
      toast.success(`${data.classroom.name} deleted`, {
        description: `${r.studentsDeleted} student${r.studentsDeleted === 1 ? "" : "s"} removed, ${r.membershipsRemoved - r.studentsDeleted} kept in other cohorts.`,
      });
      router.navigate({ to: "/dashboard" });
    },
    onError: (e) => toast.error(String(e)),
  });

  const [editingClassroom, setEditingClassroom] = useState<{
    name: string; description: string;
  } | null>(null);
  const updateCls = useServerFn(updateClassroom);
  const renameM = useMutation({
    mutationFn: (v: { name: string; description: string }) =>
      updateCls({ data: { id, name: v.name, description: v.description || null } }),
    onSuccess: (r) => {
      setEditingClassroom(null);
      // Every surface that prints a classroom name: the sidebar, the dashboard
      // cards, the overview rollup and the search results.
      qc.invalidateQueries({ queryKey: ["classroom", id] });
      qc.invalidateQueries({ queryKey: ["classrooms"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["search"] });
      toast.success(`Renamed to ${r.name}`);
    },
    onError: (e) => toast.error(String(e)),
  });

  const removeFromCohort = useServerFn(removeStudentFromClassroom);
  const [removing, setRemoving] = useState<{ id: string; name: string; shared: boolean } | null>(null);
  const removeM = useMutation({
    mutationFn: (studentId: string) =>
      removeFromCohort({ data: { studentId, classroomId: id } }),
    onSuccess: (r) => {
      setRemoving(null);
      qc.invalidateQueries({ queryKey: ["classroom", id] });
      qc.invalidateQueries({ queryKey: ["classrooms"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      toast.success(
        r.studentDeleted
          ? "Student deleted — that was their last cohort"
          : `Removed from this cohort · still in ${r.remainingClassrooms} other${r.remainingClassrooms === 1 ? "" : "s"}`,
      );
    },
    onError: (e) => toast.error(String(e)),
  });

  const rows = useMemo(
    () => data.students.map((s) => toStudentRow(s)),
    [data.students],
  );

  const counts = useMemo(() => bucketCounts(rows), [rows]);

  /*
    Class rank is derived here rather than fetched: the roster is already in hand,
    and it must reflect THIS cohort even when the server also knows about others.
    Dense ranking (ties share a place, no gap after) to match the SQL — otherwise
    two students tied 5th would show 5th here and 5th/7th on their profiles.
  */
  const ranksById = useMemo(() => {
    const byTotal = [...rows].sort((a, b) => b.total - a.total);
    const classRank = new Map<string, number>();
    let place = 0;
    let previousTotal: number | null = null;
    for (const r of byTotal) {
      if (previousTotal === null || r.total !== previousTotal) place += 1;
      previousTotal = r.total;
      classRank.set(r.id, place);
    }
    return new Map(
      data.students.map((s) => [
        s.id,
        {
          classRank: classRank.get(s.id) ?? null,
          collegeRank: s.ranks?.college_rank ?? null,
          collegeTotal: s.ranks?.college_total ?? null,
        },
      ]),
    );
  }, [rows, data.students]);

  const rankOf = (studentId: string) =>
    ranksById.get(studentId) ?? { classRank: null, collegeRank: null, collegeTotal: null };

  const sharedIds = useMemo(
    () => new Set(data.students.filter((s) => s.shared).map((s) => s.id)),
    [data.students],
  );

  // Admin-only query; faculty get an empty set and no badges, which is correct —
  // resolving a duplicate is an admin action.
  const { data: dupes = [] } = useDuplicates(canAdminister);
  const duplicateHandles = useMemo(
    () => new Set(dupes.filter((d) => d.kind === "leetcode_id").map((d) => d.value)),
    [dupes],
  );
  // A duplicated roll is the old multi-classroom workaround sitting in the data.
  // Invisible from the roster otherwise, since both rows look perfectly normal.
  const duplicateRolls = useMemo(
    () => new Set(dupes.filter((d) => d.kind === "roll").map((d) => d.value)),
    [dupes],
  );

  const filtered = useMemo(() => {
    const bFiltered = filterBucket(rows, bucket);
    const q = search.toLowerCase().trim();
    const list = q
      ? bFiltered.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            r.roll.toLowerCase().includes(q) ||
            r.leetcode_id.toLowerCase().includes(q),
        )
      : bFiltered;
    return [...list].sort((a, b) => {
      const dir = sort.dir === "asc" ? 1 : -1;
      const get = (r: typeof a): number | string => {
        switch (sort.key) {
          case "name": return r.name.toLowerCase();
          case "roll": return r.roll.toLowerCase();
          case "total": return r.total;
          case "easy": return r.easy;
          case "medium": return r.medium;
          case "hard": return r.hard;
          case "today": return r.today;
          case "yesterday": return r.yesterday;
          case "week": return r.week;
          case "month": return r.month;
          case "streak": return r.streak;
          // Ranks sort ascending-is-better; MAX_SAFE_INTEGER parks the unranked at
          // the bottom either way rather than pretending they are joint first.
          case "classRank": return rankOf(r.id).classRank ?? Number.MAX_SAFE_INTEGER;
          case "collegeRank": return rankOf(r.id).collegeRank ?? Number.MAX_SAFE_INTEGER;
          case "lcRank": return r.rank;
        }
      };
      const av = get(a); const bv = get(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [rows, search, sort, bucket]);

  const cohort = useMemo(() => ({
    total: rows.reduce((s, r) => s + r.total, 0),
    today: rows.reduce((s, r) => s + r.today, 0),
    week: rows.reduce((s, r) => s + r.week, 0),
    easy: rows.reduce((s, r) => s + r.easy, 0),
    medium: rows.reduce((s, r) => s + r.medium, 0),
    hard: rows.reduce((s, r) => s + r.hard, 0),
    avg: rows.length ? Math.round(rows.reduce((s, r) => s + r.total, 0) / rows.length) : 0,
  }), [rows]);

  /*
    Cohort progress from daily_snapshots — the same measure the Daily Matrix
    shows, so the header and the grid can no longer disagree. Only students whose
    latest snapshot is the cohort's latest snapshot count toward the sum; a
    student stuck three days back would otherwise fold three days of catch-up
    into "newly solved" for one day.
  */
  const progress = useMemo(() => {
    const withProgress = data.students
      .map((s) => s.progress)
      .filter((p): p is NonNullable<typeof p> => p != null && p.solvedSince != null);
    if (withProgress.length === 0) {
      return { solved: null, hint: "no snapshot history yet" };
    }
    const latestDate = withProgress.reduce((a, p) => (p.date > a ? p.date : a), "");
    const current = withProgress.filter((p) => p.date === latestDate);
    const solved = current.reduce((s, p) => s + (p.solvedSince ?? 0), 0);
    const span = Math.max(...current.map((p) => p.daysSpan ?? 1));
    const stale = withProgress.length - current.length;

    return {
      solved,
      hint:
        span > 1
          ? `over ${span} days to ${latestDate}${stale ? ` · ${stale} behind` : ""}`
          : `on ${latestDate}${stale ? ` · ${stale} behind` : ""}`,
    };
  }, [data.students]);

  const [topN, setTopN] = useState(10);
  // Bucket-filtered but not search-filtered: typing a name shouldn't reduce the
  // leaderboard to one row, but selecting "At Risk" should rank that group.
  const bucketRows = useMemo(() => filterBucket(rows, bucket), [rows, bucket]);
  const ranked = useMemo(
    () => [...bucketRows].sort((a, b) => b.total - a.total).slice(0, topN),
    [bucketRows, topN],
  );

  const [cEasy, cMedium, cHard, cSurface, cBorder, cMutedFg, cPrimary] = useCssVars(
    "--easy", "--medium", "--hard", "--surface", "--border", "--muted-foreground", "--primary",
  );

  const [activeDiff, setActiveDiff] = useState<number | null>(null);
  const diff = [
    { name: "Easy", value: cohort.easy, color: cEasy },
    { name: "Medium", value: cohort.medium, color: cMedium },
    { name: "Hard", value: cohort.hard, color: cHard },
  ];
  const centerDiff = activeDiff != null ? diff[activeDiff] : null;


  const trend = useMemo(() => {
    const out: { day: string; solved: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(); d.setUTCDate(d.getUTCDate() - i);
      const key = String(Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000));
      let sum = 0;
      for (const r of rows) sum += r.calendar[key] ?? 0;
      out.push({ day: `${d.getUTCMonth()+1}/${d.getUTCDate()}`, solved: sum });
    }
    return out;
  }, [rows]);

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" },
    );
  }

  function exportCsv() {
    const header = [
      "Name","Roll","Email","LeetCode","Total","Easy","Medium","Hard",
      "Today","Yesterday","ThisWeek","Last30","Streak","Rank",
    ];
    const lines = filtered.map((r) => {
      const s = data.students.find((x) => x.id === r.id)!;
      return [
        r.name, r.roll, s.email ?? "", r.leetcode_id,
        r.total, r.easy, r.medium, r.hard,
        r.today, r.yesterday, r.week, r.last30, r.streak,
        s.stats?.ranking ?? "",
      ].map((v) => `"${String(v).replace(/"/g,'""')}"`).join(",");
    });
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.classroom.name.replace(/\s+/g,"_")}_report.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }



  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const typing =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "1") { setTab("report"); }
      else if (e.key === "2") { setTab("matrix"); }
      else if (e.key.toLowerCase() === "b") {
        const el = document.getElementById(`bucket-${bucket}`);
        el?.focus();
      } else if (e.key.toLowerCase() === "e") {
        exportCsv();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket, filtered]);

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to="/dashboard" className="mb-2 inline-block font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-primary">
            ← Dashboard
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">{data.classroom.name}</h1>
          {data.classroom.description && (
            <p className="mt-1 text-sm text-muted-foreground">{data.classroom.description}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {roleLoading ? (
            // Render the row at its final height so the header doesn't reflow once
            // the role resolves.
            <Skeleton className="h-9 w-64" />
          ) : (
            <>
              {canManageStudents && (
                <>
                  <Button asChild variant="outline">
                    <Link to="/classrooms/$id/students/new" params={{ id }}>
                      <Plus className="mr-1 size-4" /> Add students
                    </Link>
                  </Button>
                  <RefreshButton scope="classroom" classroomId={id} />
                </>
              )}
              <Button variant="outline" onClick={exportCsv} title="Export summary CSV (E)">
                <Download className="mr-1 size-4" /> Export summary
              </Button>
              {canAdminister && (
                <Button
                  variant="outline"
                  onClick={() =>
                    setEditingClassroom({
                      name: data.classroom.name,
                      description: data.classroom.description ?? "",
                    })
                  }
                >
                  <Pencil className="mr-1 size-4" /> Rename
                </Button>
              )}
              {canAdminister && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" aria-label="Delete classroom">
                      <Trash2 className="size-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete classroom</AlertDialogTitle>
                      {/*
                        "and all its students" stopped being true once students
                        could belong to several cohorts — shared students survive.
                        The numbers come from classroom_delete_preview so the
                        dialog states what will actually happen.
                      */}
                      <AlertDialogDescription asChild>
                        <div className="space-y-2 text-sm">
                          <p>
                            <b className="text-hard">
                              {data.deletePreview.orphan_count} student
                              {data.deletePreview.orphan_count === 1 ? "" : "s"} belong
                              {data.deletePreview.orphan_count === 1 ? "s" : ""} only to this cohort
                            </b>{" "}
                            — they and all their scraped history will be deleted permanently.
                          </p>
                          {data.deletePreview.shared_count > 0 && (
                            <p>
                              <b className="text-foreground">
                                {data.deletePreview.shared_count} also belong to other cohorts
                              </b>{" "}
                              — they will only be removed from this one and keep their history.
                            </p>
                          )}
                        </div>
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => delM.mutate()}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </>
          )}
        </div>
      </div>

      {/*
        Labels name the measure AND the window. "Today" previously read as
        "problems solved today" but was submissions on the current UTC day from
        LeetCode's calendar, which is a different number from the matrix's
        newly-solved delta — the two disagreed and nothing said why.
      */}
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Students" value={rows.length} />
        <StatCard
          label="Solved (total)"
          value={cohort.total.toLocaleString()}
          hint="unique problems"
        />
        <StatCard
          label="Newly solved"
          value={progress.solved === null ? "—" : `+${progress.solved}`}
          hint={progress.hint}
        />
        <StatCard label="Submissions today" value={cohort.today} hint="UTC day · at last sync" />
        <StatCard label="Submissions this week" value={cohort.week} hint="UTC Mon–today" />
        <StatCard label="Avg / student" value={cohort.avg} hint="lifetime solved" />
      </div>

      {!hideScrapingStatus && (() => {
        const pending = data.students.filter((s) => !s.last_scraped_at).length;
        const failed = data.students.filter((s) => s.scrape_error).length;
        const scraped = data.students.length - pending;
        const latest = data.students
          .map((s) => s.last_scraped_at)
          .filter((v): v is string => !!v)
          .sort()
          .at(-1);
        const errors = data.students
          .filter((s) => s.scrape_error)
          .slice(0, 5);
        return (
          <div className="mb-8 rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Scraping status
              </span>
              <span className="text-easy">✓ Scraped: <b className="font-mono">{scraped}</b></span>
              <span className="text-medium">⏳ Pending: <b className="font-mono">{pending}</b></span>
              <span className="text-hard">✕ Failed: <b className="font-mono">{failed}</b></span>
              {latest && (
                <span className="text-muted-foreground">
                  Last run: <span className="font-mono">{new Date(latest).toLocaleString()}</span>
                </span>
              )}
              {pending > 0 && (
                <span className="ml-auto mr-4 text-xs text-muted-foreground">
                  Click <b>Refresh all</b> to scrape pending students.
                </span>
              )}
              <button
                className="ml-auto grid size-6 place-items-center rounded hover:bg-muted"
                onClick={() => setHideScrapingStatus(true)}
                title="Dismiss status panel"
              >
                <X className="size-4" />
              </button>
            </div>
            {errors.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-hard">
                  Show {failed} failing student{failed === 1 ? "" : "s"}
                </summary>
                <ul className="mt-2 space-y-1 font-mono text-[11px] text-muted-foreground">
                  {errors.map((s) => (
                    <li key={s.id}>
                      <span className="text-foreground">{s.roll}</span> · {s.leetcode_id} — {s.scrape_error}
                    </li>
                  ))}
                  {failed > errors.length && <li>… and {failed - errors.length} more</li>}
                </ul>
              </details>
            )}
          </div>
        );
      })()}

      <div className="mb-8 grid gap-6 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface p-6 lg:col-span-2">
          <h3 className="mb-4 text-sm font-bold uppercase tracking-wider">30-Day Cohort Activity</h3>
          <div className="h-56">
            <ResponsiveContainer>
              <LineChart data={trend}>
                <CartesianGrid stroke={cBorder} strokeDasharray="3 3" />
                <XAxis dataKey="day" fontSize={10} stroke={cMutedFg} />
                <YAxis fontSize={10} stroke={cMutedFg} />
                <Tooltip contentStyle={{ background: cSurface, border: `1px solid ${cBorder}`, fontSize: 12, color: cMutedFg }} />
                <Line
                  type="monotone"
                  dataKey="solved"
                  stroke={cPrimary}
                  strokeWidth={2}
                  dot={false}
                  {...chartMotion}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-6">
          <h3 className="mb-4 text-sm font-bold uppercase tracking-wider">Difficulty</h3>
          <div className="relative h-56">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  {...chartMotion}
                  data={diff}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={45}
                  outerRadius={75}
                  paddingAngle={2}
                  strokeWidth={0}
                  activeIndex={activeDiff ?? undefined}
                  onMouseEnter={(_, i) => setActiveDiff(i)}
                  onMouseLeave={() => setActiveDiff(null)}
                >
                  {diff.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className="text-2xl font-bold leading-none text-foreground">{centerDiff ? centerDiff.value : cohort.total}</div>
                <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {centerDiff ? centerDiff.name : "Solved"}
                </div>
              </div>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center font-mono text-[10px]">
            <div><span className="text-easy">■</span> Easy {cohort.easy}</div>
            <div><span className="text-medium">■</span> Med {cohort.medium}</div>
            <div><span className="text-hard">■</span> Hard {cohort.hard}</div>
          </div>
        </div>
      </div>

      <div className="mb-8 rounded-lg border border-border bg-surface p-6">
        <div className="mb-1 flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold uppercase tracking-wider">Leaderboard</h3>
          <TopNControl value={topN} max={bucketRows.length} onChange={setTopN} />
        </div>
        <p className="mb-4 text-[11px] text-muted-foreground">
          Hover a row to see the count. Follows the bucket filter.
        </p>
        <div className="max-h-[520px] overflow-y-auto pr-1">
          <LeaderboardBars entries={ranked} />
        </div>
      </div>

      <SectionTitle>Buckets · click or use ← → to filter</SectionTitle>
      <div
        role="radiogroup"
        aria-label="Filter students by bucket"
        className="mb-4 flex flex-wrap gap-2"
        onKeyDown={(e) => {
          const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
          if (!keys.includes(e.key)) return;
          e.preventDefault();
          const idx = BUCKETS.findIndex((b) => b.id === bucket);
          let next = idx;
          if (e.key === "ArrowRight") next = (idx + 1) % BUCKETS.length;
          if (e.key === "ArrowLeft") next = (idx - 1 + BUCKETS.length) % BUCKETS.length;
          if (e.key === "Home") next = 0;
          if (e.key === "End") next = BUCKETS.length - 1;
          const target = BUCKETS[next];
          setBucket(target.id);
          const btn = document.getElementById(`bucket-${target.id}`);
          btn?.focus();
        }}
      >
        {BUCKETS.map((b) => {
          const active = bucket === b.id;
          return (
            <button
              key={b.id}
              id={`bucket-${b.id}`}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onClick={() => setBucket(b.id)}
              className={cn(
                "rounded-lg border px-4 py-2 text-left transition-[color,background-color,border-color]",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                active
                  ? "border-primary bg-primary/10"
                  : "border-border bg-surface hover:border-primary/50",
              )}
            >
              <div className={cn(
                "font-mono text-[9px] uppercase tracking-widest",
                active ? "text-primary" : "text-muted-foreground",
              )}>
                {b.label}
              </div>
              <div className="font-mono text-xl font-bold">{counts[b.id]}</div>
            </button>
          );
        })}
      </div>

      <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Shortcuts: <kbd className="rounded border border-border px-1">1</kbd> report ·
        <kbd className="ml-1 rounded border border-border px-1">2</kbd> matrix ·
        <kbd className="ml-1 rounded border border-border px-1">/</kbd> search ·
        <kbd className="ml-1 rounded border border-border px-1">B</kbd> buckets ·
        <kbd className="ml-1 rounded border border-border px-1">E</kbd> export summary ·
        <kbd className="ml-1 rounded border border-border px-1">M</kbd> export matrix
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as "report" | "matrix")} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="report">Day-wise report</TabsTrigger>
          <TabsTrigger value="matrix">Daily matrix</TabsTrigger>
        </TabsList>

        <TabsContent value="report" className="mt-0">
          <div className="mb-3 flex items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, roll, or leetcode… ( / )"
                className="pl-9"
              />
            </div>
            <span className="ml-auto font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {filtered.length} / {rows.length} shown · bucket: <b className="text-primary">{BUCKETS.find((b) => b.id === bucket)?.label}</b>
              {" · "}
              {/* The two halves of this table are different units and nothing said so. */}
              <span className="text-muted-foreground">
                Total/E/M/H are problems solved; Today/Yest./Week/30d are submissions
              </span>
            </span>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-background/60 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <Th onClick={() => toggleSort("name")}>Student</Th>
                  <Th onClick={() => toggleSort("roll")}>Roll</Th>
                  <th className="px-3 py-3">LeetCode</th>
                  <Th right onClick={() => toggleSort("total")}>Total</Th>
                  <Th right onClick={() => toggleSort("easy")} className="text-easy">E</Th>
                  <Th right onClick={() => toggleSort("medium")} className="text-medium">M</Th>
                  <Th right onClick={() => toggleSort("hard")} className="text-hard">H</Th>
                  <Th right onClick={() => toggleSort("today")}>Today</Th>
                  <Th right onClick={() => toggleSort("yesterday")}>Yest.</Th>
                  <Th right onClick={() => toggleSort("week")}>Week</Th>
                  <Th right onClick={() => toggleSort("month")}>30d</Th>
                  <Th right onClick={() => toggleSort("streak")}>Streak</Th>
                  <Th right onClick={() => toggleSort("classRank")} title="Rank within this cohort by problems solved">Class</Th>
                  <Th right onClick={() => toggleSort("collegeRank")} title="Rank across every student on the platform">College</Th>
                  <Th right onClick={() => toggleSort("lcRank")} title="LeetCode's worldwide ranking, from their profile">LC World</Th>
                  {canManageStudents && <th className="px-3 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono">
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={canManageStudents ? 14 : 13}
                      className="px-4 py-16 text-center text-muted-foreground"
                    >
                      No students match this bucket.
                    </td>
                  </tr>
                )}
                {filtered.map((r) => {
                  const s = data.students.find((x) => x.id === r.id)!;
                  return (
                    <tr
                      key={r.id}
                      className={cn(
                        "group cursor-pointer transition-colors hover:bg-primary/5",
                        s.scrape_error && "border-l-2 border-l-hard",
                      )}
                      onClick={() => router.navigate({ to: "/students/$roll", params: { roll: r.roll } })}
                    >
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          {s.stats?.avatar ? (
                            <img
                              src={s.stats.avatar}
                              alt=""
                              className="size-7 rounded bg-muted object-cover"
                              onError={(e) => (e.currentTarget.style.display = "none")}
                            />
                          ) : (
                            <div className="grid size-7 place-items-center rounded bg-muted font-sans text-[10px] font-bold">
                              {r.name.slice(0, 2).toUpperCase()}
                            </div>
                          )}
                          <span className="font-sans font-semibold">{r.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {r.roll}
                        {duplicateRolls.has(r.roll.trim().toLowerCase()) && (
                          <Link
                            to="/scrape-runs"
                            onClick={(e) => e.stopPropagation()}
                            title="This roll number belongs to more than one student record — probably the same person in two cohorts. Resolve under Scrape History → Duplicates"
                            className="ml-1.5 inline-flex items-center align-middle text-medium hover:text-foreground"
                          >
                            <TriangleAlert className="size-3.5" />
                          </Link>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {s.scrape_error ? (
                          <span className="inline-flex items-center gap-1 text-hard font-bold" title={s.scrape_error}>
                            {r.leetcode_id} ⚠️
                          </span>
                        ) : (
                          <a
                            href={`https://leetcode.com/u/${r.leetcode_id}/`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            {r.leetcode_id}
                            <ExternalLink className="size-3" />
                          </a>
                        )}
                        {/* One student, one profile. A shared handle means this
                            profile is being scraped once per student and building
                            two divergent histories — otherwise only discoverable
                            on an admin page nobody opens. */}
                        {duplicateHandles.has(r.leetcode_id.toLowerCase()) && (
                          <Link
                            to="/scrape-runs"
                            onClick={(e) => e.stopPropagation()}
                            title="This LeetCode ID is shared with another student — resolve it under Scrape History → Duplicates"
                            className="ml-1.5 inline-flex items-center align-middle text-medium hover:text-foreground"
                          >
                            <TriangleAlert className="size-3.5" />
                          </Link>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right font-bold">{r.total || "—"}</td>
                      <td className="px-3 py-3 text-right text-easy">{r.easy || "—"}</td>
                      <td className="px-3 py-3 text-right text-medium">{r.medium || "—"}</td>
                      <td className="px-3 py-3 text-right text-hard">{r.hard || "—"}</td>
                      <td className="px-3 py-3 text-right">
                        {r.today > 0 ? <span className="text-primary">+{r.today}</span> : <span className="text-muted-foreground">0</span>}
                      </td>
                      <td className="px-3 py-3 text-right text-muted-foreground">{r.yesterday || "—"}</td>
                      <td className="px-3 py-3 text-right">{r.week || "—"}</td>
                      <td className="px-3 py-3 text-right">{r.last30 || "—"}</td>
                      <td className="px-3 py-3 text-right">{r.streak}d</td>
                      {/* Three ranks, three questions. Class is where they sit in
                          this room, College across the platform, LC World is
                          LeetCode's own global number off their profile. */}
                      <td className="px-3 py-3 text-right font-bold text-primary">
                        {rankOf(r.id).classRank ? `#${rankOf(r.id).classRank}` : "—"}
                      </td>
                      <td className="px-3 py-3 text-right font-bold">
                        {rankOf(r.id).collegeRank ? `#${rankOf(r.id).collegeRank}` : "—"}
                      </td>
                      <td className="px-3 py-3 text-right text-muted-foreground">
                        {s.stats?.ranking ? `#${s.stats.ranking.toLocaleString()}` : "—"}
                      </td>
                      {canManageStudents && (
                        <td className="px-3 py-3 text-right">
                          <button
                            type="button"
                            title="Edit student"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingStudent({
                                id: s.id,
                                name: s.name,
                                roll: s.roll,
                                email: s.email ?? "",
                                leetcode_id: s.leetcode_id,
                              });
                            }}
                            className="inline-flex size-7 items-center justify-center rounded border border-transparent text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 hover:border-border hover:bg-accent hover:text-foreground"
                          >
                            <Pencil className="size-3" />
                          </button>
                          {/* Net-new. The old deleteStudent had no caller and a
                              student id alone can no longer identify what to
                              remove — this removes ONE membership. */}
                          <button
                            type="button"
                            title={
                              sharedIds.has(s.id)
                                ? "Remove from this cohort (stays in others)"
                                : "Remove from this cohort (deletes the student)"
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              setRemoving({ id: s.id, name: s.name, shared: sharedIds.has(s.id) });
                            }}
                            className="ml-1 inline-flex size-7 items-center justify-center rounded border border-transparent text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 hover:border-border hover:bg-hard/10 hover:text-hard"
                          >
                            <UserMinus className="size-3" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="matrix" className="mt-0">
          <div className="mb-2 flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            <span>Anchor: <b className="text-foreground">{new Date(data.classroom.created_at).toUTCString().slice(5, 16)}</b></span>
            <span>·</span>
            <span>Filter follows bucket: <b className="text-primary">{BUCKETS.find((b) => b.id === bucket)?.label}</b></span>
          </div>
          <DailyMatrix
            classroomId={data.classroom.id}
            rows={filtered.map((r) => ({ id: r.id, name: r.name, roll: r.roll }))}
            startDate={new Date(data.classroom.created_at)}
          />
        </TabsContent>
      </Tabs>

      {rows.some((r) => data.students.find((x) => x.id === r.id)?.scrape_error) && (
        <div className="mt-4 rounded-lg border border-hard/30 bg-hard/5 p-4 text-xs">
          <strong className="text-hard">Some scrapes failed.</strong> Common reason: LeetCode
          username not found. Verify the handle on the student's profile.
        </div>
      )}

      {/* Rename. Admin-only, and the server rejects a name another cohort already
          holds — the bulk importer resolves classrooms by lowercased name, so two
          cohorts sharing one would send future imports to whichever it found. */}
      <Dialog
        open={!!editingClassroom}
        onOpenChange={(o) => !o && setEditingClassroom(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename classroom</DialogTitle>
            <DialogDescription>
              Students, history and assignments are untouched — only the label changes.
            </DialogDescription>
          </DialogHeader>

          <form
            id="rename-classroom-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (editingClassroom?.name.trim() && !renameM.isPending) {
                renameM.mutate(editingClassroom);
              }
            }}
          >
            <div>
              <Label htmlFor="cls-name">Name</Label>
              <Input
                id="cls-name"
                value={editingClassroom?.name ?? ""}
                onChange={(e) =>
                  setEditingClassroom((c) => (c ? { ...c, name: e.target.value } : c))
                }
                className="mt-1"
                maxLength={100}
                autoFocus
                required
              />
            </div>
            <div>
              <Label htmlFor="cls-desc">Description</Label>
              <Input
                id="cls-desc"
                value={editingClassroom?.description ?? ""}
                onChange={(e) =>
                  setEditingClassroom((c) => (c ? { ...c, description: e.target.value } : c))
                }
                className="mt-1"
                maxLength={500}
                placeholder="optional"
              />
            </div>
            <p className="rounded-md bg-medium/10 px-2 py-1.5 text-[11px] text-muted-foreground">
              A CSV that still lists the old name will create a new, empty classroom
              rather than matching this one. Update your import sheets too.
            </p>
          </form>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditingClassroom(null)}
              disabled={renameM.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="rename-classroom-form"
              disabled={
                renameM.isPending ||
                !editingClassroom?.name.trim() ||
                (editingClassroom.name === data.classroom.name &&
                  editingClassroom.description === (data.classroom.description ?? ""))
              }
            >
              {renameM.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/*
        Removing a student now means removing ONE membership. The copy has to
        branch: for a shared student this is reversible in effect (they keep
        everything), for their last cohort it destroys their whole history.
      */}
      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {removing?.name} from {data.classroom.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.shared
                ? "They stay in their other cohorts and keep all their scraped history."
                : "This is their only cohort, so their profile and all scraped history will be deleted permanently. This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removing && removeM.mutate(removing.id)}
              className={removing?.shared ? undefined : "bg-hard text-white hover:bg-hard/90"}
            >
              {removeM.isPending
                ? "Removing…"
                : removing?.shared
                  ? "Remove from cohort"
                  : "Delete student"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit student modal */}
      {editingStudent && (
        <EditStudentModal
          student={editingStudent}
          shared={sharedIds.has(editingStudent.id)}
          onChange={setEditingStudent}
          onSave={() => editM.mutate(editingStudent)}
          onClose={() => setEditingStudent(null)}
          isPending={editM.isPending}
        />
      )}
    </div>
  );
}

/**
 * Was a hand-rolled `fixed inset-0` overlay: no enter/exit animation, no focus
 * trap, no Escape-to-close — sitting next to AlertDialogs that had all three.
 * Radix Dialog picks up the tuned animate-in/animate-out curves from styles.css.
 */
function EditStudentModal({
  student,
  shared,
  onChange,
  onSave,
  onClose,
  isPending,
}: {
  student: { id: string; name: string; roll: string; email: string; leetcode_id: string };
  /** True when this student belongs to more than one cohort. */
  shared: boolean;
  onChange: (s: typeof student) => void;
  onSave: () => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const set = (k: keyof typeof student) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...student, [k]: e.target.value });

  const canSave = !!student.name && !!student.roll && !!student.leetcode_id;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Student</DialogTitle>
          <DialogDescription className="font-mono text-[10px]">
            {student.roll} · id: {student.id.slice(0, 8)}…
          </DialogDescription>
          {shared && (
            <p className="flex items-start gap-1.5 rounded-md bg-medium/10 px-2 py-1.5 text-left text-[11px] text-muted-foreground">
              <Users2 className="mt-px size-3.5 shrink-0 text-medium" />
              <span>
                Also in other cohorts — changes apply everywhere. Roll number and LeetCode ID
                are admin-only for shared students.
              </span>
            </p>
          )}
        </DialogHeader>

        <form
          id="edit-student-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave && !isPending) onSave();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="edit-name">Name</Label>
            <Input id="edit-name" value={student.name} onChange={set("name")} className="mt-1" required />
          </div>
          <div>
            <Label htmlFor="edit-roll">Roll Number</Label>
            <Input id="edit-roll" value={student.roll} onChange={set("roll")} className="mt-1" required />
          </div>
          <div>
            <Label htmlFor="edit-email">Email <span className="text-muted-foreground">(optional)</span></Label>
            <Input id="edit-email" type="email" value={student.email} onChange={set("email")} className="mt-1" placeholder="student@college.edu" />
          </div>
          <div>
            <Label htmlFor="edit-lc">LeetCode Username</Label>
            <Input id="edit-lc" value={student.leetcode_id} onChange={set("leetcode_id")} className="mt-1" placeholder="leetcode_handle" required />
          </div>
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" form="edit-student-form" disabled={isPending || !canSave}>
            {isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Th({
  children,
  onClick,
  right,
  className,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  right?: boolean;
  className?: string;
  /** Three columns now end in "rank"; the tooltip says which is which. */
  title?: string;
}) {
  return (
    <th
      onClick={onClick}
      title={title}
      className={cn(
        "cursor-pointer select-none px-3 py-3 font-semibold hover:text-foreground",
        right && "text-right",
        className,
      )}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {onClick && <ArrowUpDown className="size-3 opacity-40" />}
      </span>
    </th>
  );
}

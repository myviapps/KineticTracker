import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import {
  queryOptions,
  useSuspenseQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  ExternalLink,
  ArrowUpDown,
  Download,
  Pencil,
  UserMinus,
  Users2,
  TriangleAlert,
  Users,
  Target,
  Flame,
  Activity,
  LayoutGrid,
  Trophy,
  Columns3,
  type LucideIcon,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

import {
  getClassroom,
  deleteClassroom,
  updateClassroom,
  listClassrooms,
} from "@/lib/classrooms.functions";
import {
  updateStudent,
  removeStudentFromClassroom,
  moveStudentToClassroom,
} from "@/lib/students.functions";
import { EditStudentModal } from "@/components/edit-student-modal";
import { rememberClassroom } from "@/lib/last-classroom";
import {
  ALL_COLUMNS_VISIBLE,
  OPTIONAL_COLUMNS,
  readColumnVisibility,
  writeColumnVisibility,
  type ColumnVisibility,
  type OptionalColumnId,
} from "@/lib/table-columns";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CohortPlatformReport } from "@/components/cohort-platform-report";
import { CohortOverall } from "@/components/cohort-overall";
import { ReportExportDialog } from "@/components/report-export-dialog";
import { toStudentRow, type StudentRow } from "@/lib/buckets";
import { DailyMatrix } from "@/components/daily-matrix";
import { StreakMatrix } from "@/components/streak-matrix";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { CHART_MOTION, CHART_MOTION_STATIC } from "@/lib/chart-motion";
import { RefreshButton } from "@/components/refresh-button";
import { useRole } from "@/hooks/use-role";
import { useRefreshJobStatus } from "@/hooks/use-refresh-job";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { AnimatedLoader } from "@/components/animated-loader";
import { useDuplicates } from "@/components/duplicates";
import { CohortFilterBar } from "@/components/cohort-filter-bar";
import { CohortToolbar } from "@/components/cohort-toolbar";
import { LensStatRow } from "@/components/lens-stat-row";
import { CohortInsightPanel } from "@/components/cohort-insight-panel";
import { clampTrendDays } from "@/components/trend-window-control";
import { ScrapeStatusBadge } from "@/components/scrape-status-badge";
import { getPerformanceWindows } from "@/lib/performance.functions";
import {
  ALL_LENS,
  lensFor,
  lensFilters,
  applyLensFilter,
  lensStatCards,
  hasDifficultySplit,
  lensMetric,
} from "@/lib/platform-lens";

/**
 * Sum several per-platform series onto a shared date axis.
 *
 * Platforms refresh on different days, so their series have different — and
 * sometimes disjoint — date sets. Zipping by index would add Monday's Codeforces
 * to Thursday's GeeksforGeeks; keying by date is the only correct merge.
 */
function mergeSeries(all: { date: string; solved: number }[][]) {
  const byDate = new Map<string, number>();
  for (const series of all) {
    for (const p of series) byDate.set(p.date, (byDate.get(p.date) ?? 0) + p.solved);
  }
  return [...byDate.entries()]
    .map(([date, solved]) => ({ date, solved }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const clsQO = (id: string) =>
  queryOptions({
    queryKey: ["classroom", id],
    queryFn: () => getClassroom({ data: { id } }),
  });

function PendingClassroom() {
  return <AnimatedLoader text="Loading classroom…" />;
}

/**
 * Filter state is component-local.
 *
 * It lived in the URL for a while, on the theory that a filtered cohort should
 * be a link you can send someone. In practice every filter change became a
 * navigation: the loader re-ran, memos recomputed, and the router's view
 * transition cross-faded the whole document to apply a sort — so routine
 * filtering read as a page reload. Sharing a filtered view turned out to be
 * rare; filtering turned out to be constant.
 *
 * The cost is that filters reset on refresh, which is the accepted trade.
 */
const SORT_KEYS: SortKey[] = [
  "name",
  "roll",
  "total",
  "easy",
  "medium",
  "hard",
  "today",
  "yesterday",
  "week",
  "month",
  "streak",
  "classRank",
  "collegeRank",
  "contests",
];

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

/**
 * Icon per stat-card label. Keyed by label rather than by metric so the mapping
 * lives next to the labels it describes; anything unmapped falls back to Target.
 */
const LENS_ICONS: Record<string, LucideIcon> = {
  Students: Users,
  "On platform": Users,
  Coverage: Users2,
  "Platforms tracked": LayoutGrid,
  "Avg Almanac Score": Trophy,
  "Solved (all platforms)": Target,
  "Total solved": Target,
  "Problems solved": Target,
  Contests: Trophy,
  "On a streak": Flame,
  "Avg rating": Trophy,
  "Cohort best": Trophy,
  "Avg score": Trophy,
  "Top score": Trophy,
  "Solved (30d)": Flame,
  "Active (30d)": Activity,
};

type SortKey =
  | "name"
  | "roll"
  | "total"
  | "easy"
  | "medium"
  | "hard"
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "streak"
  | "classRank"
  | "collegeRank"
  | "contests";

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
  const { status: refreshStatus } = useRefreshJobStatus();
  const qc = useQueryClient();

  /*
    The local "refresh finished -> invalidate" effect that used to sit here is
    gone; see the note on the overview route. Every key it touched is already
    covered by SCRAPE_TOUCHED_KEYS, and it inherited the same edge-triggered
    blind spot it was meant to patch. useRefreshJobStatus now drives this off a
    server-side pulse instead.
  */
  const chartMotion =
    refreshStatus === "running" || refreshStatus === "queued" ? CHART_MOTION_STATIC : CHART_MOTION;
  const [search, setSearch] = useState("");
  // The lens: "all" or a platform id. Resolved against the platforms this cohort
  // actually uses, so a stale id degrades to "all" rather than an empty page.
  // Recorded so the Classrooms jump page can mark this cohort as the one you
  // were last in — see lib/last-classroom.ts.
  useEffect(() => {
    rememberClassroom(id);
  }, [id]);

  const [lensId, setLensId] = useState<string>(ALL_LENS);
  const lens = lensFor(lensId, data.platforms);
  const [filterId, setFilterId] = useState("all");
  // Changing platform resets the chip: a Codeforces rating band means nothing
  // once the lens is GeeksforGeeks, and leaving it set would silently filter the
  // roster by a rule that no longer applies.
  const setLens = (p: string) => {
    setLensId(p);
    setFilterId("all");
  };
  const [tab, setTab] = useState<"report" | "matrix" | "streak">("report");

  /*
    Anchor date for the Streak Matrix — the "X" in "what streak did they have
    on X". Defaults to today, held as a yyyy-mm-dd string because that is what
    <input type="date"> speaks, and parsed as UTC on the way out so it lines up
    with the submission calendar (which is keyed on UTC days).
  */
  const [streakAnchor, setStreakAnchor] = useState(() => new Date().toISOString().slice(0, 10));
  const [streakDays, setStreakDays] = useState(30);
  const streakAnchorDate = useMemo(() => new Date(`${streakAnchor}T00:00:00Z`), [streakAnchor]);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "total",
    dir: "desc",
  });

  const [exportOpen, setExportOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [editingStudent, setEditingStudent] = useState<{
    id: string;
    name: string;
    roll: string;
    email: string;
    leetcode_id: string;
  } | null>(null);

  // The roll the student had when the edit modal OPENED — before onChange
  // rewrites editingStudent. Without this, a roll change invalidates only the
  // new query key and the old one shows stale data until a hard reload.
  const [originalEditRoll, setOriginalEditRoll] = useState<string | null>(null);

  const updateStu = useServerFn(updateStudent);
  const editM = useMutation({
    mutationFn: (s: {
      id: string;
      name: string;
      roll: string;
      email: string;
      leetcode_id: string;
      /** platform id -> handle; "" removes. Omitted when nothing was touched. */
      handles?: Record<string, string>;
    }) =>
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
    onSuccess: (res, s) => {
      const h = res?.handles;
      const changed = h ? h.added + h.updated + h.removed : 0;
      toast.success(
        changed > 0
          ? `Student updated · ${changed} platform handle${changed === 1 ? "" : "s"} changed`
          : "Student updated",
        changed > 0 ? { description: "New handles are fetched on the next refresh." } : undefined,
      );
      setEditingStudent(null);

      // Broad invalidation so the edit propagates across the entire platform —
      // not just this classroom. A shared student appears in multiple cohorts,
      // the overview, rankings, and search.
      qc.invalidateQueries({ queryKey: ["classroom"] });
      qc.invalidateQueries({ queryKey: ["classrooms"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["rankings"] });
      qc.invalidateQueries({ queryKey: ["search"] });
      qc.invalidateQueries({ queryKey: ["colleges"] });
      qc.invalidateQueries({ queryKey: ["student-handles", s.id] });

      // Invalidate the student profile for the NEW roll…
      qc.invalidateQueries({ queryKey: ["student", s.roll] });
      // …and the OLD roll if it changed, so an open tab on the old URL refetches
      // rather than showing the now-stale record.
      if (originalEditRoll && originalEditRoll !== s.roll) {
        qc.invalidateQueries({ queryKey: ["student", originalEditRoll] });
      }
      setOriginalEditRoll(null);
    },
    onError: (e) => toast.error(String(e)),
  });

  /*
    Cohorts to move into. Shares the sidebar's ["classrooms"] cache, so this is
    usually already resolved and costs nothing. Admin-only, matching the server
    gate on moveStudentToClassroom — no point fetching a picker faculty cannot
    act on.
  */
  const listCls = useServerFn(listClassrooms);
  const { data: classroomList } = useQuery({
    queryKey: ["classrooms"],
    queryFn: () => listCls(),
    enabled: canAdminister,
    staleTime: 60_000,
  });
  const allClassrooms = useMemo(
    () =>
      (classroomList?.classrooms ?? [])
        .filter((c) => c.id !== id)
        .map((c) => ({ id: c.id, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [classroomList, id],
  );

  const moveStu = useServerFn(moveStudentToClassroom);
  const moveM = useMutation({
    mutationFn: (v: { studentId: string; toClassroomId: string; mode: "move" | "add" }) =>
      moveStu({
        data: {
          studentId: v.studentId,
          toClassroomId: v.toClassroomId,
          // Only a move needs the origin; an add leaves this cohort alone.
          ...(v.mode === "move" ? { fromClassroomId: id } : {}),
          mode: v.mode,
        },
      }),
    onSuccess: (_r, v) => {
      const target = allClassrooms.find((c) => c.id === v.toClassroomId)?.name ?? "the cohort";
      toast.success(v.mode === "move" ? `Moved to ${target}` : `Also added to ${target}`);
      setEditingStudent(null);
      qc.invalidateQueries({ queryKey: ["classroom"] });
      qc.invalidateQueries({ queryKey: ["classrooms"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["rankings"] });
    },
    onError: (e) => toast.error(String(e)),
  });

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
    name: string;
    description: string;
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
  const [removing, setRemoving] = useState<{ id: string; name: string; shared: boolean } | null>(
    null,
  );
  const removeM = useMutation({
    mutationFn: (studentId: string) => removeFromCohort({ data: { studentId, classroomId: id } }),
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

  const rows = useMemo(() => data.students.map((s) => toStudentRow(s)), [data.students]);

  /** student id -> that student's per-platform stats, for every lens helper. */
  const statsByStudent = useMemo(
    () => new Map(data.students.map((s) => [s.id, s.platformStats ?? {}])),
    [data.students],
  );

  /*
    `StudentRow.total` is LeetCode-only (see buckets.ts). The roster table's
    `classRank` further down is intentionally LeetCode-only too and is hidden
    outside that lens — but the Leaderboard tab of the insight panel isn't
    lens-gated, so it needs the active lens's own metric instead of always
    falling back to LeetCode's total.
  */
  const almanacById = useMemo(
    () => new Map(data.students.map((s) => [s.id, s.ranks?.almanac_score ?? null])),
    [data.students],
  );
  const metricOf = (r: StudentRow): number =>
    lens.isAll
      ? (almanacById.get(r.id) ?? 0)
      : (lensMetric(statsByStudent.get(r.id)?.[lens.id], lens.rank_metric) ?? 0);

  // Whatever chips this lens offers: the nine behavioural buckets on LeetCode
  // and "all", metric bands on every other platform.
  const lensFilterSet = useMemo(
    () => lensFilters(lens, rows, statsByStudent),
    [lens, rows, statsByStudent],
  );

  /*
    Per-platform 30-day history for this cohort, from daily_snapshots.

    This is what replaces the LeetCode submission calendar as the trend source.
    `solved` comes back NULL rather than 0 when a platform has no history, which
    is the difference between "nobody did anything" and "we only started
    collecting yesterday" — see the header comment in performance.functions.ts.
  */
  /*
    Trend lookback — LOCAL, like the Classroom Leaderboard's movement window.
    It changes how far back one chart looks, not which students the page is
    about, so it does not survive in a shared link and does not need to: the
    recipient opens the same cohort and slides it themselves.
  */
  const [trendDays, setTrendDaysState] = useState(30);
  const setTrendDays = (d: number) => setTrendDaysState(clampTrendDays(d));

  /*
    Optional movement columns. Starts fully visible and is corrected from
    localStorage in an effect — reading storage during render would make the
    first client paint disagree with the server markup. See table-columns.ts.
  */
  const [columns, setColumns] = useState<ColumnVisibility>(ALL_COLUMNS_VISIBLE);
  useEffect(() => setColumns(readColumnVisibility()), []);
  const toggleColumn = (id: OptionalColumnId) =>
    setColumns((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      writeColumnVisibility(next);
      return next;
    });
  const hiddenColumnCount = OPTIONAL_COLUMNS.filter((c) => !columns[c.id]).length;

  /*
    Column widths as percentages of whatever is currently visible.

    Without this the table was `table-auto w-full`, which fills the container
    but hands ALL the slack to the one column that has no width of its own —
    Student. Hiding two movement columns therefore did not spread the table out,
    it just grew one cell into a wide empty gutter with a truncated name sitting
    at the left of it. Recomputing shares means hiding a column redistributes its
    space across every remaining one instead.

    Weights, not pixels: Student carries a name and a roll and needs the most,
    the two identifier columns need more than a number, and every numeric column
    is interchangeable with the others. `table-fixed` on the table is what makes
    the browser honour these rather than treating them as suggestions.
  */
  const columnWidths = (() => {
    const weights: number[] = [3.2, 1.7, 2.1, 1.15]; // Student, Roll, LeetCode, Total
    weights.push(1, 1, 1); // Easy, Medium, Hard
    weights.push(1); // Today
    if (columns.yesterday) weights.push(1.25);
    if (columns.week) weights.push(1);
    if (columns.month) weights.push(1);
    weights.push(1.1, 1, 1.15, 1.25); // Streak, Class, College, Contests
    if (canManageStudents) weights.push(1.3); // Actions
    const total = weights.reduce((a, w) => a + w, 0);
    return weights.map((w) => `${((w / total) * 100).toFixed(3)}%`);
  })();
  /*
    Twelve always-on columns — Student, Roll, LeetCode, Total, Easy, Medium,
    Hard, Today, Streak, Class, College, Contests — plus however many of the
    three movement windows are showing, plus Actions when it renders.

    Derived rather than hardcoded. The literal it replaces said 14/13 against a
    header that renders 15/14, so the "no students match" row already stopped one
    column short of the table; a toggleable column would have made it wrong on
    every other render.
  */
  const leetcodeColSpan =
    12 + (OPTIONAL_COLUMNS.length - hiddenColumnCount) + (canManageStudents ? 1 : 0);

  const perfQuery = useQuery({
    // trendDays is part of the key: without it, widening the window would serve
    // the cached 30-day answer and the chart would not move.
    queryKey: ["cohort-performance", id, trendDays],
    queryFn: () => getPerformanceWindows({ data: { windows: [trendDays], classroomId: id } }),
    staleTime: 60_000,
    // The previous window stays on screen while the new one loads, instead of
    // the panel dropping to its "No history yet" empty state mid-switch.
    placeholderData: (prev) => prev,
  });
  // Memoised: `?? []` allocates a new array each render, which would make every
  // downstream useMemo that depends on it recompute on every render.
  const windowPlatforms = useMemo(
    () => perfQuery.data?.windows?.[0]?.platforms ?? [],
    [perfQuery.data],
  );
  const lensWindow = lens.isAll ? null : windowPlatforms.find((w) => w.platform_id === lens.id);
  const allWindowSolved = windowPlatforms.length
    ? windowPlatforms.reduce<number | null>(
        (a, w) => (w.solved === null ? a : (a ?? 0) + w.solved),
        null,
      )
    : null;

  const lensCards = useMemo(
    () =>
      lensStatCards({
        lens,
        rows,
        statsByStudent,
        almanacScoreOf: (sid) =>
          data.students.find((s) => s.id === sid)?.ranks?.almanac_score ?? null,
        platforms: data.platforms,
        windowSolved: lens.isAll ? allWindowSolved : (lensWindow?.solved ?? null),
        // The trend slider decides the window this page queried (see perfQuery),
        // so it has to decide the label too. Pinned at 30 the cards showed a
        // 7-day figure under a "Solved (30d)" heading the moment anyone moved
        // the slider.
        windowDays: trendDays,
        // Union across platforms, not the max: someone practising on two sites
        // is one active student, and max under-counted every such cohort.
        activeInWindow: lens.isAll
          ? (perfQuery.data?.windows?.[0]?.active_any ?? null)
          : (lensWindow?.active_students ?? null),
        firstSnapshotDate: lens.isAll
          ? (windowPlatforms
              .map((w) => w.first_snapshot_date)
              .filter(Boolean)
              .sort()[0] ?? null)
          : (lensWindow?.first_snapshot_date ?? null),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      lens,
      rows,
      statsByStudent,
      data.platforms,
      lensWindow,
      allWindowSolved,
      windowPlatforms,
      trendDays,
      perfQuery.data,
    ],
  );

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
    const bFiltered = applyLensFilter(lens, rows, statsByStudent, filterId);
    const q = search.toLowerCase().trim();
    const studentById = new Map(data.students.map((s) => [s.id, s]));
    const list = q
      ? bFiltered.filter((r) => {
          if (r.name.toLowerCase().includes(q)) return true;
          if (r.roll.toLowerCase().includes(q)) return true;
          if (r.leetcode_id && r.leetcode_id.toLowerCase().includes(q)) return true;
          const st = studentById.get(r.id);
          if (st?.email && st.email.toLowerCase().includes(q)) return true;
          if (st?.platformStats) {
            for (const pStat of Object.values(st.platformStats)) {
              if (pStat.handle && pStat.handle.toLowerCase().includes(q)) return true;
            }
          }
          return false;
        })
      : bFiltered;
    return [...list].sort((a, b) => {
      const dir = sort.dir === "asc" ? 1 : -1;
      const get = (r: typeof a): number | string => {
        switch (sort.key) {
          case "name":
            return r.name.toLowerCase();
          case "roll":
            return r.roll.toLowerCase();
          case "total":
            return r.total;
          case "easy":
            return r.easy;
          case "medium":
            return r.medium;
          case "hard":
            return r.hard;
          case "today":
            return r.today;
          case "yesterday":
            return r.yesterday;
          case "week":
            return r.week;
          case "month":
            return r.month;
          case "streak":
            return r.streak;
          // Ranks sort ascending-is-better; MAX_SAFE_INTEGER parks the unranked at
          // the bottom either way rather than pretending they are joint first.
          case "classRank":
            return rankOf(r.id).classRank ?? Number.MAX_SAFE_INTEGER;
          case "collegeRank":
            return rankOf(r.id).collegeRank ?? Number.MAX_SAFE_INTEGER;
          case "contests":
            // Descending-is-better like the solve counts, not like the ranks.
            return r.contests;
        }
      };
      const av = get(a);
      const bv = get(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, data.students, search, sort.key, sort.dir, lens, statsByStudent, filterId]);

  const filteredStudentIds = useMemo(() => new Set(filtered.map((r) => r.id)), [filtered]);
  const filteredStudents = useMemo(
    () => data.students.filter((s) => filteredStudentIds.has(s.id)),
    [data.students, filteredStudentIds],
  );

  const cohort = useMemo(
    () => ({
      total: rows.reduce((s, r) => s + r.total, 0),
      today: rows.reduce((s, r) => s + r.today, 0),
      week: rows.reduce((s, r) => s + r.week, 0),
      easy: rows.reduce((s, r) => s + r.easy, 0),
      medium: rows.reduce((s, r) => s + r.medium, 0),
      hard: rows.reduce((s, r) => s + r.hard, 0),
      // No `avg` here. It divided by headcount while every card and every sheet
      // divides by students who actually have data, so it was a third
      // definition of "average" — and nothing read it. Removed rather than
      // reconciled: see lensStatCards, which is the one that renders.
    }),
    [rows],
  );

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
  // Filter-scoped but not search-filtered: typing a name shouldn't reduce the
  // leaderboard to one row, but selecting "At Risk" should rank that group.
  const bucketRows = useMemo(
    () => applyLensFilter(lens, rows, statsByStudent, filterId),
    [lens, rows, statsByStudent, filterId],
  );
  const ranked = useMemo(
    () => [...bucketRows].sort((a, b) => metricOf(b) - metricOf(a)).slice(0, topN),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bucketRows, topN, lens, almanacById, statsByStudent],
  );

  /*
    Difficulty for the current lens.

    On LeetCode this still comes from student_stats, which is the live store and
    the most current thing we have. Every other lens reads daily_snapshots, where
    each platform records whatever split it publishes — and `null` there means
    "this platform reports no split", which is what decides donut vs histogram.
  */
  const lensDifficulty = useMemo(() => {
    if (lens.id === "leetcode" || lens.isAll) {
      return { easy: cohort.easy, medium: cohort.medium, hard: cohort.hard };
    }
    return {
      easy: lensWindow?.easy ?? null,
      medium: lensWindow?.medium ?? null,
      hard: lensWindow?.hard ?? null,
    };
  }, [lens, cohort, lensWindow]);

  /*
    LeetCode's calendar-derived figures. They are real data and worth keeping,
    but they cannot be part of the primary row — no other platform publishes a
    submission feed, so a card that exists on one lens and vanishes on the next
    is exactly the inconsistency that made this page hard to read. They live in
    the disclosure instead.
  */
  const leetcodeExtraStats = useMemo(
    () =>
      lens.id !== "leetcode"
        ? []
        : [
            {
              label: "Newly solved",
              value: progress.solved === null ? "—" : `+${progress.solved}`,
              hint: progress.hint,
              tone: (progress.solved === null ? "default" : "easy") as "default" | "easy",
            },
            {
              label: "Submissions today",
              value: cohort.today.toLocaleString(),
              hint: "UTC day · at last sync",
            },
            {
              label: "Submissions this week",
              value: cohort.week.toLocaleString(),
              hint: "UTC Mon–today",
            },
          ],
    [lens.id, progress, cohort],
  );

  const showDifficulty = hasDifficultySplit(lensDifficulty);
  const difficultyValues = {
    easy: lensDifficulty.easy ?? 0,
    medium: lensDifficulty.medium ?? 0,
    hard: lensDifficulty.hard ?? 0,
  };

  /** Fallback panel when a platform publishes no difficulty split. */
  const bandHistogram = useMemo(
    () =>
      lensFilterSet.filters
        .filter((f) => f.id !== "all")
        .map((f) => ({ label: f.label, count: f.count })),
    [lensFilterSet],
  );

  /*
    Trend, from daily_snapshots rather than the LeetCode submission calendar.

    The calendar only exists on LeetCode, so the old chart drew LeetCode activity
    no matter which platform the page claimed to be showing. daily_snapshots is
    keyed by platform, so every lens gets its own honest line — and an empty
    series means "no history", which the panel says rather than drawing a flat
    zero.
  */
  const trendSeries = useMemo(() => {
    const series = lens.isAll
      ? mergeSeries(windowPlatforms.map((w) => w.series))
      : (lensWindow?.series ?? []);
    return series.map((p) => {
      const [, m, d] = p.date.split("-");
      return { day: `${Number(m)}/${Number(d)}`, solved: p.solved };
    });
  }, [lens.isAll, lensWindow, windowPlatforms]);

  const trendSince = lens.isAll
    ? (windowPlatforms
        .map((w) => w.first_snapshot_date)
        .filter((v): v is string => !!v)
        .sort()[0] ?? null)
    : (lensWindow?.first_snapshot_date ?? null);

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" },
    );
  }

  function exportCsv() {
    const header = [
      "Name",
      "Roll",
      "Email",
      "LeetCode",
      "Total",
      "Easy",
      "Medium",
      "Hard",
      "Today",
      "Yesterday",
      "ThisWeek",
      "Last30",
      "Streak",
      "Contests",
    ];
    const lines = filtered.map((r) => {
      const s = data.students.find((x) => x.id === r.id)!;
      return [
        r.name,
        r.roll,
        s.email ?? "",
        r.leetcode_id,
        r.total,
        r.easy,
        r.medium,
        r.hard,
        r.today,
        r.yesterday,
        r.week,
        r.last30,
        r.streak,
        r.contests,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",");
    });
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.classroom.name.replace(/\s+/g, "_")}_report.csv`;
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
      if (e.key === "1") {
        setTab("report");
      } else if (e.key === "2") {
        setTab("matrix");
      } else if (e.key === "3" && (lens.isAll || lens.id === "leetcode")) {
        setTab("streak");
      } else if (e.key.toLowerCase() === "b") {
        document.getElementById(`filter-${filterId}`)?.focus();
      } else if (e.key.toLowerCase() === "p") {
        // The lens is now the primary control, so it gets a shortcut too.
        document.getElementById(`lens-${lens.id}`)?.focus();
      } else if (e.key.toLowerCase() === "e") {
        exportCsv();
      } else if (e.key.toLowerCase() === "m") {
        /*
          The legend has advertised M since the matrix shipped and nothing was
          ever bound to it. Rather than duplicate an export function up here, it
          activates the same button the user would click — so the shortcut and
          the control can never drift apart, and it does nothing (correctly) on
          a tab where no grid is mounted.
        */
        document.getElementById(tab === "streak" ? "export-streak" : "export-matrix")?.click();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterId, lens.id, filtered, tab]);

  return (
    /*
      Three bands, not one container: the page header scrolls away, the lens bar
      pins under the app header, then the content. The bar needs to be outside
      the padded container so its border spans the full width, and it carries the
      cohort name so context survives once the header above it is gone.
    */
    <div>
      <div className="mx-auto max-w-[1600px] px-4 pb-4 pt-6 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Link
              to="/dashboard"
              className="mb-2 inline-block font-mono text-3xs uppercase tracking-widest text-muted-foreground hover:text-primary"
            >
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
                <Button
                  variant="outline"
                  onClick={() => setExportOpen(true)}
                  title="Export a multi-sheet report, optionally across several cohorts"
                >
                  Export report
                </Button>
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
                                {data.deletePreview.orphan_count === 1 ? "s" : ""} only to this
                                cohort
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
      </div>

      <CohortFilterBar
        title={data.classroom.name}
        subtitle={lens.isAll ? "All platforms" : lens.name}
        platforms={data.platforms}
        value={lens.id}
        onChange={setLens}
        shownCount={filtered.length}
        totalCount={rows.length}
        status={<ScrapeStatusBadge students={data.students} />}
      />

      <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {/*
        Search and the filter chips sit together, directly under the lens they
        belong to — the search box used to be inside the report tab, invisible
        from the matrix view even though it filtered both.
      */}
        {/* ZONE 1 — four cards, everything else folded away. */}
        <LensStatRow
          cards={lensCards}
          icons={LENS_ICONS}
          fallbackIcon={Target}
          extra={leetcodeExtraStats}
        />

        {/* ZONE 2 — one panel, three tabs. Was three stacked sections. */}
        <CohortInsightPanel
          title={lens.isAll ? "All platforms" : lens.name}
          trend={trendSeries}
          trendEmptyNote={
            trendSince
              ? `collecting since ${new Date(trendSince).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short",
                })}`
              : "starts after the first refresh"
          }
          trendWindowDays={trendDays}
          onTrendWindowDays={setTrendDays}
          difficulty={showDifficulty ? difficultyValues : null}
          bands={bandHistogram}
          board={ranked.map((r) => ({ id: r.id, name: r.name, roll: r.roll, total: metricOf(r) }))}
          boardMax={bucketRows.length}
          topN={topN}
          onTopN={setTopN}
          animate={chartMotion !== CHART_MOTION_STATIC}
        />

        {/* ZONE 3 — the roster. Search and chips sit against the table they
            filter, not three sections above it. */}
        <CohortToolbar
          ref={searchRef}
          search={search}
          onSearch={setSearch}
          filters={lensFilterSet}
          value={filterId}
          onFilter={setFilterId}
          placeholder={
            lens.isAll || lens.id === "leetcode"
              ? "Search name, roll, or leetcode… ( / )"
              : `Search name, roll, or ${lens.name} handle… ( / )`
          }
        />

        {/*
        The view switch sits directly above the data it switches — no more
        scrolling past stats, charts and the leaderboard to find it. The bucket
        pills live inside the tab strip so the filter is reachable from either
        view instead of buried between sections.
      */}
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as "report" | "matrix" | "streak")}
          className="w-full"
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="report">Day-wise report</TabsTrigger>
              <TabsTrigger value="matrix">Daily matrix</TabsTrigger>
              {/* LeetCode-only: it reads the submission calendar, which no other
                  platform publishes. Offering it under a Codeforces lens would
                  be offering an empty grid. */}
              {(lens.isAll || lens.id === "leetcode") && (
                <TabsTrigger value="streak">Streak matrix</TabsTrigger>
              )}
            </TabsList>
            <div className="hidden font-mono text-3xs uppercase tracking-widest text-muted-foreground md:block">
              Shortcuts: <kbd className="rounded border border-border px-1">1</kbd> report ·
              <kbd className="ml-1 rounded border border-border px-1">2</kbd> matrix ·
              <kbd className="ml-1 rounded border border-border px-1">3</kbd> streak ·
              <kbd className="ml-1 rounded border border-border px-1">/</kbd> search ·
              <kbd className="ml-1 rounded border border-border px-1">P</kbd> platform ·
              <kbd className="ml-1 rounded border border-border px-1">B</kbd> filters ·
              <kbd className="ml-1 rounded border border-border px-1">E</kbd> export summary ·
              <kbd className="ml-1 rounded border border-border px-1">M</kbd> export matrix
            </div>
          </div>

          <TabsContent value="report" className="mt-0">
            {/* The two halves of this table are different units and nothing said so. */}
            {lens.id === "leetcode" && (
              <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
                <span className="hidden rounded-md border border-border bg-surface px-2 py-1 font-mono text-3xs text-muted-foreground xl:inline">
                  Total/Easy/Medium/Hard = solved · Today/Yesterday/Week/30d = submissions
                </span>
                {/*
                  Fifteen columns is more than a laptop can show without a
                  horizontal scrollbar, and the three movement windows are the
                  ones people read only some of the time. Hiding them is a
                  preference, so it persists per browser rather than per visit.
                */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 px-2">
                      <Columns3 className="mr-1 size-3.5" />
                      <span className="font-mono text-3xs uppercase tracking-widest">Columns</span>
                      {hiddenColumnCount > 0 && (
                        <span className="ml-1.5 rounded bg-primary/15 px-1 font-mono text-3xs text-primary">
                          {hiddenColumnCount} hidden
                        </span>
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuLabel className="font-mono text-3xs uppercase tracking-widest">
                      Movement windows
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {OPTIONAL_COLUMNS.map((c) => (
                      <DropdownMenuCheckboxItem
                        key={c.id}
                        checked={columns[c.id]}
                        onCheckedChange={() => toggleColumn(c.id)}
                        onSelect={(e) => e.preventDefault()}
                      >
                        {c.label}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}

            <ReportExportDialog
              open={exportOpen}
              onOpenChange={setExportOpen}
              preselectClassroomIds={[data.classroom.id]}
            />

            {/* The lens in the sticky bar decides which report this is. PlatformTabs
              used to do it from down here, below the stats and charts it was
              meant to govern — so the page could show LeetCode numbers while the
              selector said Codeforces. */}
            {lens.isAll && <CohortOverall students={filteredStudents} platforms={data.platforms} />}

            {!lens.isAll &&
              lens.id !== "leetcode" &&
              (() => {
                const sel = data.platforms.find((pl) => pl.id === lens.id);
                return sel ? (
                  <CohortPlatformReport platform={sel} students={filteredStudents} />
                ) : null;
              })()}

            <div
              className="overflow-x-auto rounded-lg border border-border bg-surface"
              hidden={lens.id !== "leetcode"}
            >
              {/*
                min-w keeps `table-fixed` honest on a narrow screen: without a
                floor the fixed layout would squeeze fifteen columns into a phone
                and render a grid of ellipses. Below the floor the wrapper's
                overflow-x-auto takes over, which is the behaviour that was
                already there.
              */}
              <table className="w-full min-w-[62rem] table-fixed text-left text-sm">
                <colgroup>
                  {columnWidths.map((w, i) => (
                    <col key={i} style={{ width: w }} />
                  ))}
                </colgroup>
                <thead className="border-b border-border bg-background/60 font-mono text-3xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <Th onClick={() => toggleSort("name")} sorted={sort.key === "name" && sort.dir}>
                      Student
                    </Th>
                    <Th onClick={() => toggleSort("roll")} sorted={sort.key === "roll" && sort.dir}>
                      Roll
                    </Th>
                    <th className="px-3 py-3">LeetCode</th>
                    <Th
                      right
                      onClick={() => toggleSort("total")}
                      sorted={sort.key === "total" && sort.dir}
                    >
                      Total
                    </Th>
                    <Th
                      right
                      onClick={() => toggleSort("easy")}
                      sorted={sort.key === "easy" && sort.dir}
                      className="text-easy"
                    >
                      Easy
                    </Th>
                    <Th
                      right
                      onClick={() => toggleSort("medium")}
                      sorted={sort.key === "medium" && sort.dir}
                      className="text-medium"
                    >
                      Medium
                    </Th>
                    <Th
                      right
                      onClick={() => toggleSort("hard")}
                      sorted={sort.key === "hard" && sort.dir}
                      className="text-hard"
                    >
                      Hard
                    </Th>
                    <Th
                      right
                      onClick={() => toggleSort("today")}
                      sorted={sort.key === "today" && sort.dir}
                    >
                      Today
                    </Th>
                    {columns.yesterday && (
                      <Th
                        right
                        onClick={() => toggleSort("yesterday")}
                        sorted={sort.key === "yesterday" && sort.dir}
                      >
                        Yesterday
                      </Th>
                    )}
                    {columns.week && (
                      <Th
                        right
                        onClick={() => toggleSort("week")}
                        sorted={sort.key === "week" && sort.dir}
                      >
                        Week
                      </Th>
                    )}
                    {columns.month && (
                      <Th
                        right
                        onClick={() => toggleSort("month")}
                        sorted={sort.key === "month" && sort.dir}
                      >
                        30d
                      </Th>
                    )}
                    <Th
                      right
                      onClick={() => toggleSort("streak")}
                      sorted={sort.key === "streak" && sort.dir}
                      title="Consecutive days with a LeetCode submission, as of today"
                    >
                      Streak
                    </Th>
                    <Th
                      right
                      onClick={() => toggleSort("classRank")}
                      sorted={sort.key === "classRank" && sort.dir}
                      title="Rank in this cohort by LeetCode problems solved"
                    >
                      Class
                    </Th>
                    <Th
                      right
                      onClick={() => toggleSort("collegeRank")}
                      sorted={sort.key === "collegeRank" && sort.dir}
                      title="Rank across the college by Almanac Score (all platforms)"
                    >
                      College
                    </Th>
                    <Th
                      right
                      onClick={() => toggleSort("contests")}
                      sorted={sort.key === "contests" && sort.dir}
                      title="LeetCode contests this student has entered"
                    >
                      Contests
                    </Th>
                    {canManageStudents && (
                      <th className="whitespace-nowrap px-2 py-3 text-right">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border font-mono">
                  {filtered.length === 0 && (
                    <tr>
                      <td
                        colSpan={leetcodeColSpan}
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
                          "cursor-pointer transition-colors hover:bg-primary/5",
                          s.scrape_error && "border-l-2 border-l-hard",
                        )}
                        onClick={() =>
                          router.navigate({ to: "/students/$roll", params: { roll: r.roll } })
                        }
                      >
                        {/*
                          Capped and truncated. Every other column is sized by
                          its own content, so this is the column that absorbs
                          whatever width is left — and, before the cap, the one
                          that pushed the table past the viewport the moment a
                          cohort contained a long name. The full name is still
                          reachable via the title attribute and the profile.
                        */}
                        <td className="px-3 py-3">
                          {/*
                            No max-width here any more — the colgroup above sets
                            this column's width and `table-fixed` makes it stick,
                            so a cap would only reintroduce the gutter it was
                            added to remove. The name still shrinks: `truncate`
                            sets overflow:hidden, which zeroes a flex item's
                            automatic minimum size.
                          */}
                          <div className="flex min-w-0 items-center gap-2">
                            {s.stats?.avatar ? (
                              <img
                                src={s.stats.avatar}
                                alt=""
                                className="size-7 shrink-0 rounded bg-muted object-cover"
                                onError={(e) => (e.currentTarget.style.display = "none")}
                              />
                            ) : (
                              <div className="grid size-7 shrink-0 place-items-center rounded bg-muted font-sans text-3xs font-bold">
                                {r.name.slice(0, 2).toUpperCase()}
                              </div>
                            )}
                            <span className="truncate font-sans font-semibold" title={r.name}>
                              {r.name}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          <div className="flex min-w-0 items-center">
                            <span className="truncate" title={r.roll}>
                              {r.roll}
                            </span>
                            {duplicateRolls.has(r.roll.trim().toLowerCase()) && (
                              <Link
                                to="/scrape-runs"
                                onClick={(e) => e.stopPropagation()}
                                title="This roll number belongs to more than one student record — probably the same person in two cohorts. Resolve under Scrape History → Duplicates"
                                className="ml-1.5 inline-flex shrink-0 items-center align-middle text-medium hover:text-foreground"
                              >
                                <TriangleAlert className="size-3.5" />
                              </Link>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex min-w-0 items-center">
                            {s.scrape_error ? (
                              <span
                                className="flex items-center gap-1 truncate font-bold text-hard"
                                title={s.scrape_error}
                              >
                                <span className="truncate">{r.leetcode_id}</span> ⚠️
                              </span>
                            ) : (
                              <a
                                href={`https://leetcode.com/u/${r.leetcode_id}/`}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-center gap-1 truncate text-primary hover:underline"
                                title={r.leetcode_id}
                              >
                                <span className="truncate">{r.leetcode_id}</span>
                                <ExternalLink className="size-3 shrink-0" />
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
                                className="ml-1.5 inline-flex shrink-0 items-center align-middle text-medium hover:text-foreground"
                              >
                                <TriangleAlert className="size-3.5" />
                              </Link>
                            )}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-2 py-3 text-right font-bold">
                          {r.total || "—"}
                        </td>
                        <td className="whitespace-nowrap px-2 py-3 text-right text-easy">
                          {r.easy || "—"}
                        </td>
                        <td className="whitespace-nowrap px-2 py-3 text-right text-medium">
                          {r.medium || "—"}
                        </td>
                        <td className="whitespace-nowrap px-2 py-3 text-right text-hard">
                          {r.hard || "—"}
                        </td>
                        <td className="whitespace-nowrap px-2 py-3 text-right">
                          {r.today > 0 ? (
                            <span className="text-primary">+{r.today}</span>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </td>
                        {columns.yesterday && (
                          <td className="whitespace-nowrap px-2 py-3 text-right text-muted-foreground">
                            {r.yesterday || "—"}
                          </td>
                        )}
                        {columns.week && (
                          <td className="whitespace-nowrap px-2 py-3 text-right">
                            {r.week || "—"}
                          </td>
                        )}
                        {columns.month && (
                          <td className="whitespace-nowrap px-2 py-3 text-right">
                            {r.last30 || "—"}
                          </td>
                        )}
                        <td className="whitespace-nowrap px-2 py-3 text-right">{r.streak}d</td>
                        {/* Two ranks, then participation. Class is where they sit
                          in this room, College across the platform. The third
                          column used to be LeetCode's worldwide ranking, which
                          nobody acted on; contests entered is something a
                          student can actually change this week. */}
                        <td className="whitespace-nowrap px-2 py-3 text-right font-bold text-primary">
                          {rankOf(r.id).classRank ? `#${rankOf(r.id).classRank}` : "—"}
                        </td>
                        <td className="whitespace-nowrap px-2 py-3 text-right font-bold">
                          {rankOf(r.id).collegeRank ? `#${rankOf(r.id).collegeRank}` : "—"}
                        </td>
                        <td className="whitespace-nowrap px-2 py-3 text-right text-muted-foreground">
                          {r.contests || "—"}
                        </td>
                        {canManageStudents && (
                          <td className="whitespace-nowrap px-2 py-3 text-right">
                            <button
                              type="button"
                              title="Edit student"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOriginalEditRoll(s.roll);
                                setEditingStudent({
                                  id: s.id,
                                  name: s.name,
                                  roll: s.roll,
                                  email: s.email ?? "",
                                  leetcode_id: s.leetcode_id,
                                });
                              }}
                              className="inline-flex size-7 items-center justify-center rounded border border-border/60 text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground"
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
                                setRemoving({
                                  id: s.id,
                                  name: s.name,
                                  shared: sharedIds.has(s.id),
                                });
                              }}
                              className="ml-1 inline-flex size-7 items-center justify-center rounded border border-border/60 text-muted-foreground transition-colors hover:border-hard/50 hover:bg-hard/10 hover:text-hard"
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
            <div className="mb-2 flex flex-wrap items-center gap-3 font-mono text-3xs uppercase tracking-widest text-muted-foreground">
              <span>
                Anchor:{" "}
                <b className="text-foreground">
                  {new Date(data.classroom.created_at).toUTCString().slice(5, 16)}
                </b>
              </span>
              <span>·</span>
              <span>
                Filter:{" "}
                <b className="text-primary">
                  {lensFilterSet.filters.find((f) => f.id === filterId)?.label ?? "All"}
                </b>
              </span>
            </div>
            <DailyMatrix
              classroomId={data.classroom.id}
              rows={filtered.map((r) => ({ id: r.id, name: r.name, roll: r.roll }))}
              startDate={new Date(data.classroom.created_at)}
              platformId={lens.isAll ? "all" : lens.id}
            />
          </TabsContent>

          <TabsContent value="streak" className="mt-0">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-3xs uppercase tracking-widest text-muted-foreground">
                    As of
                  </span>
                  <input
                    type="date"
                    value={streakAnchor}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => e.target.value && setStreakAnchor(e.target.value)}
                    className="h-8 rounded-md border border-border bg-background px-2 font-mono text-xs"
                  />
                </label>
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-3xs uppercase tracking-widest text-muted-foreground">
                    Window
                  </span>
                  <div className="flex h-8 rounded-md border border-border p-0.5" role="group">
                    {[14, 30, 60, 90].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setStreakDays(d)}
                        aria-pressed={streakDays === d}
                        className={
                          streakDays === d
                            ? "rounded bg-primary px-2 font-mono text-3xs font-medium text-primary-foreground"
                            : "rounded px-2 font-mono text-3xs text-muted-foreground hover:text-foreground"
                        }
                      >
                        {d}d
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="font-mono text-3xs uppercase tracking-widest text-muted-foreground">
                Filter:{" "}
                <b className="text-primary">
                  {lensFilterSet.filters.find((f) => f.id === filterId)?.label ?? "All"}
                </b>
              </div>
            </div>
            {/*
              `filtered` is the same roster the report tab shows, so the lens,
              search box and bucket chips all apply here without extra wiring —
              and StudentRow already carries the submission calendar this needs,
              so the whole view costs no server round trip.
            */}
            <StreakMatrix rows={filtered} anchor={streakAnchorDate} days={streakDays} />
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
        <Dialog open={!!editingClassroom} onOpenChange={(o) => !o && setEditingClassroom(null)}>
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
              <p className="rounded-md bg-medium/10 px-2 py-1.5 text-2xs text-muted-foreground">
                A CSV that still lists the old name will create a new, empty classroom rather than
                matching this one. Update your import sheets too.
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
            canAdminister={canAdminister}
            otherClassrooms={allClassrooms}
            onMove={(toClassroomId, mode) =>
              moveM.mutate({ studentId: editingStudent.id, toClassroomId, mode })
            }
            isMoving={moveM.isPending}
            onChange={setEditingStudent}
            onSave={(handles) => editM.mutate({ ...editingStudent, handles })}
            onClose={() => setEditingStudent(null)}
            isPending={editM.isPending}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Was a hand-rolled `fixed inset-0` overlay: no enter/exit animation, no focus
 * trap, no Escape-to-close — sitting next to AlertDialogs that had all three.
 * Radix Dialog picks up the tuned animate-in/animate-out curves from styles.css.
 */

/**
 * A sortable header cell.
 *
 * The sort arrow renders ONLY on the column actually being sorted. It used to
 * render on all fifteen, which said nothing about the current sort and cost
 * ~16px of width apiece — a quarter of the overflow that put a horizontal
 * scrollbar on this table at 1080p. The others get it on hover instead, which
 * is where a discoverability affordance belongs.
 *
 * Right-aligned columns are the numeric ones and take tighter padding: their
 * content is three or four digits, so px-3 was spending more on gutters than on
 * data across a dozen columns.
 */
function Th({
  children,
  onClick,
  right,
  className,
  title,
  sorted,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  right?: boolean;
  className?: string;
  /** Three columns now end in "rank"; the tooltip says which is which. */
  title?: string;
  /** Direction when this column is the active sort, false otherwise. */
  sorted?: "asc" | "desc" | false;
}) {
  return (
    <th
      onClick={onClick}
      title={title}
      aria-sort={sorted ? (sorted === "asc" ? "ascending" : "descending") : undefined}
      className={cn(
        // Deliberately wrappable. Under `table-fixed` the colgroup owns the
        // width, so a nowrap header wider than its share would spill across the
        // next column instead of being clipped. Wrapping to a second line is the
        // pressure valve — it only happens on a narrow viewport, and a slightly
        // taller header row beats a sheared one.
        "group cursor-pointer select-none py-3 align-bottom font-semibold leading-tight hover:text-foreground",
        right ? "px-2 text-right" : "px-3",
        sorted && "text-foreground",
        className,
      )}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {onClick && (
          <ArrowUpDown
            className={cn(
              "size-3 shrink-0 transition-opacity",
              sorted ? "opacity-90" : "opacity-0 group-hover:opacity-40",
            )}
          />
        )}
      </span>
    </th>
  );
}

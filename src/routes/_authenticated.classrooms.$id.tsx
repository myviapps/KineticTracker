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
  BarChart3,
  LayoutGrid,
  Trophy,
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CohortPlatformReport } from "@/components/cohort-platform-report";
import { CohortOverall } from "@/components/cohort-overall";
import { ReportExportDialog } from "@/components/report-export-dialog";
import { toStudentRow, type StudentRow } from "@/lib/buckets";
import { DailyMatrix } from "@/components/daily-matrix";
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
 * Filter state lives in the URL.
 *
 * Every filter on this page used to be component-local `useState`, so it was
 * lost on refresh, could not be shared, and — because the sidebar collapses and
 * re-navigates aggressively — was wiped by ordinary navigation. Putting it in
 * the search params makes a filtered cohort a link you can send someone.
 *
 * Every field is optional and every parse is total: a stale or hand-edited URL
 * degrades to the default view rather than throwing.
 */
export type ClassroomSearch = {
  /** Platform lens id, or "all". */
  p?: string;
  /** Free-text search. */
  q?: string;
  /** Bucket id (LeetCode/all lens) or band id (other platforms). */
  b?: string;
  v?: "report" | "matrix";
  sort?: SortKey;
  dir?: "asc" | "desc";
  /** Trend lookback in days. In the URL like every other filter, so a "last 90
   *  days" view is a link rather than a setting the next reload discards. */
  d?: number;
};

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
  "lcRank",
];

export const Route = createFileRoute("/_authenticated/classrooms/$id")({
  head: () => ({ meta: [{ title: "Classroom — Almanac" }] }),
  /*
    The INPUT type is what decides whether a <Link to="/classrooms/$id"> must
    pass search params. Typing it as Record<string, unknown> made every one of
    the six required at eight call sites across the app; Partial keeps them all
    optional while the return type stays total, so reads below never need a
    fallback.
  */
  validateSearch: (search: Partial<ClassroomSearch>): ClassroomSearch => {
    const str = (v: unknown, fallback: string) =>
      typeof v === "string" && v.length > 0 && v.length <= 100 ? v : fallback;
    const sort = str(search.sort, "total") as SortKey;
    return {
      p: str(search.p, ALL_LENS),
      q: str(search.q, ""),
      b: str(search.b, "all"),
      v: search.v === "matrix" ? "matrix" : "report",
      // An unknown key would silently sort by nothing; fall back instead.
      sort: SORT_KEYS.includes(sort) ? sort : "total",
      dir: search.dir === "asc" ? "asc" : "desc",
      // Clamped here as well as in the control: this value reaches a server
      // function that rejects anything outside 1..365, and a hand-edited URL
      // must degrade to the default view rather than to an error.
      d: clampTrendDays(search.d, 30),
    };
  },
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
  "Avg / student": BarChart3,
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
  | "lcRank";

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
  const chartMotion =
    refreshStatus === "running" || refreshStatus === "queued" ? CHART_MOTION_STATIC : CHART_MOTION;
  /*
    Filters come from the URL, not from useState. `replace: true` on every write
    so dragging a slider or typing in the search box does not fill the back
    stack — Back should leave the page, not step through filter history.
  */
  const sp = Route.useSearch();
  const navigate = Route.useNavigate();
  /*
    viewTransition: false is deliberate.

    The router sets defaultViewTransition, which is right for route -> route
    moves and wrong for these: every setter here changes a FILTER on the page
    you are already looking at. Cross-fading the whole document to apply a sort
    or a lens made each interaction read as a page reload — most obviously in
    the search box, where a transition fired per keystroke and the roster
    strobed while you typed.
  */
  const setSearchParams = (patch: Partial<ClassroomSearch>) =>
    navigate({
      search: (prev) => ({ ...prev, ...patch }),
      replace: true,
      viewTransition: false,
    });

  /*
    Roster search is LOCAL state and never touches the URL.

    It used to write `?q=` on a debounce, which kept the view shareable but cost
    a navigation for every pause in typing — the loader re-ran, every memo on
    this page recomputed, and the whole thing read as a page reload while you
    were still typing. Filtering a table you are already looking at is not a
    navigation, and the other filters on this page (lens, bucket, sort) are the
    ones worth putting in a link.

    An incoming `?q=` still seeds the box, so existing links keep working; it
    simply stops being written back.
  */
  const [search, setSearch] = useState(sp.q ?? "");
  // The lens: "all" or a platform id. Resolved against the platforms this cohort
  // actually uses, so a stale id degrades to "all" rather than an empty page.
  // Recorded so the Classrooms jump page can mark this cohort as the one you
  // were last in — see lib/last-classroom.ts.
  useEffect(() => {
    rememberClassroom(id);
  }, [id]);

  const lens = lensFor(sp.p, data.platforms);
  // Changing platform resets the chip: a Codeforces rating band means nothing
  // once the lens is GeeksforGeeks, and leaving it set would silently filter the
  // roster by a rule that no longer applies.
  const setLens = (p: string) => setSearchParams({ p, b: "all" });
  const filterId = sp.b ?? "all";
  const setFilterId = (b: string) => setSearchParams({ b });
  const tab = sp.v ?? "report";
  const setTab = (v: "report" | "matrix") => setSearchParams({ v });
  const sort = { key: sp.sort ?? "total", dir: sp.dir ?? "desc" };

  const [exportOpen, setExportOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [editingStudent, setEditingStudent] = useState<{
    id: string;
    name: string;
    roll: string;
    email: string;
    leetcode_id: string;
  } | null>(null);

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
      qc.invalidateQueries({ queryKey: ["classroom", id] });
      qc.invalidateQueries({ queryKey: ["student", s.roll] });
      qc.invalidateQueries({ queryKey: ["student-handles", s.id] });
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
  const trendDays = sp.d ?? 30;
  const setTrendDays = (d: number) => setSearchParams({ d: clampTrendDays(d) });

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
        windowDays: 30,
        activeInWindow: lens.isAll
          ? windowPlatforms.reduce((a, w) => Math.max(a, w.active_students), 0)
          : (lensWindow?.active_students ?? null),
        firstSnapshotDate: lens.isAll
          ? (windowPlatforms
              .map((w) => w.first_snapshot_date)
              .filter(Boolean)
              .sort()[0] ?? null)
          : (lensWindow?.first_snapshot_date ?? null),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lens, rows, statsByStudent, data.platforms, lensWindow, allWindowSolved, windowPlatforms],
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
          case "lcRank":
            return r.rank;
        }
      };
      const av = get(a);
      const bv = get(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, sort.key, sort.dir, lens, statsByStudent, filterId]);

  const cohort = useMemo(
    () => ({
      total: rows.reduce((s, r) => s + r.total, 0),
      today: rows.reduce((s, r) => s + r.today, 0),
      week: rows.reduce((s, r) => s + r.week, 0),
      easy: rows.reduce((s, r) => s + r.easy, 0),
      medium: rows.reduce((s, r) => s + r.medium, 0),
      hard: rows.reduce((s, r) => s + r.hard, 0),
      avg: rows.length ? Math.round(rows.reduce((s, r) => s + r.total, 0) / rows.length) : 0,
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
    setSearchParams(
      sort.key === key
        ? { sort: key, dir: sort.dir === "asc" ? "desc" : "asc" }
        : { sort: key, dir: "desc" },
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
      "Rank",
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
        s.stats?.ranking ?? "",
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
      } else if (e.key.toLowerCase() === "b") {
        document.getElementById(`filter-${filterId}`)?.focus();
      } else if (e.key.toLowerCase() === "p") {
        // The lens is now the primary control, so it gets a shortcut too.
        document.getElementById(`lens-${lens.id}`)?.focus();
      } else if (e.key.toLowerCase() === "e") {
        exportCsv();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterId, lens.id, filtered]);

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
              className="mb-2 inline-block font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-primary"
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
          onValueChange={(v) => setTab(v as "report" | "matrix")}
          className="w-full"
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="report">Day-wise report</TabsTrigger>
              <TabsTrigger value="matrix">Daily matrix</TabsTrigger>
            </TabsList>
            <div className="hidden font-mono text-[10px] uppercase tracking-widest text-muted-foreground md:block">
              Shortcuts: <kbd className="rounded border border-border px-1">1</kbd> report ·
              <kbd className="ml-1 rounded border border-border px-1">2</kbd> matrix ·
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
              <div className="mb-3 flex justify-end">
                <span className="hidden rounded-md border border-border bg-surface px-2 py-1 font-mono text-[10px] text-muted-foreground xl:inline">
                  Total/E/M/H = solved · Today/Yest./Week/30d = submissions
                </span>
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
            {lens.isAll && <CohortOverall students={data.students} platforms={data.platforms} />}

            {!lens.isAll &&
              lens.id !== "leetcode" &&
              (() => {
                const sel = data.platforms.find((pl) => pl.id === lens.id);
                return sel ? (
                  <CohortPlatformReport platform={sel} students={data.students} />
                ) : null;
              })()}

            <div
              className="overflow-x-auto rounded-lg border border-border bg-surface"
              hidden={lens.id !== "leetcode"}
            >
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-background/60 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <Th onClick={() => toggleSort("name")}>Student</Th>
                    <Th onClick={() => toggleSort("roll")}>Roll</Th>
                    <th className="px-3 py-3">LeetCode</th>
                    <Th right onClick={() => toggleSort("total")}>
                      Total
                    </Th>
                    <Th right onClick={() => toggleSort("easy")} className="text-easy">
                      E
                    </Th>
                    <Th right onClick={() => toggleSort("medium")} className="text-medium">
                      M
                    </Th>
                    <Th right onClick={() => toggleSort("hard")} className="text-hard">
                      H
                    </Th>
                    <Th right onClick={() => toggleSort("today")}>
                      Today
                    </Th>
                    <Th right onClick={() => toggleSort("yesterday")}>
                      Yest.
                    </Th>
                    <Th right onClick={() => toggleSort("week")}>
                      Week
                    </Th>
                    <Th right onClick={() => toggleSort("month")}>
                      30d
                    </Th>
                    <Th right onClick={() => toggleSort("streak")}>
                      Streak
                    </Th>
                    <Th
                      right
                      onClick={() => toggleSort("classRank")}
                      title="Rank in this cohort by LeetCode problems solved"
                    >
                      Class
                    </Th>
                    <Th
                      right
                      onClick={() => toggleSort("collegeRank")}
                      title="Rank across the college by Almanac Score (all platforms)"
                    >
                      College
                    </Th>
                    <Th
                      right
                      onClick={() => toggleSort("lcRank")}
                      title="LeetCode's worldwide ranking, from their profile"
                    >
                      LC World
                    </Th>
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
                        onClick={() =>
                          router.navigate({ to: "/students/$roll", params: { roll: r.roll } })
                        }
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
                            <span
                              className="inline-flex items-center gap-1 text-hard font-bold"
                              title={s.scrape_error}
                            >
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
                          {r.today > 0 ? (
                            <span className="text-primary">+{r.today}</span>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right text-muted-foreground">
                          {r.yesterday || "—"}
                        </td>
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
                                setRemoving({
                                  id: s.id,
                                  name: s.name,
                                  shared: sharedIds.has(s.id),
                                });
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
              platformId={lens.isAll ? undefined : lens.id}
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
              <p className="rounded-md bg-medium/10 px-2 py-1.5 text-[11px] text-muted-foreground">
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

import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, LineChart, Line, CartesianGrid,
} from "recharts";
import { Plus, RefreshCw, Trash2, ExternalLink, Search, ArrowUpDown, Download, Pencil, X } from "lucide-react";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
  AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";

import { getClassroom, deleteClassroom } from "@/lib/classrooms.functions";
import { refreshClassroom, updateStudent } from "@/lib/students.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatCard, SectionTitle } from "@/components/stat-card";
import { toStudentRow, filterBucket, bucketCounts, BUCKETS, type BucketId } from "@/lib/buckets";
import { DailyMatrix } from "@/components/daily-matrix";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useCssVars } from "@/hooks/use-css-vars";

const clsQO = (id: string) =>
  queryOptions({
    queryKey: ["classroom", id],
    queryFn: () => getClassroom({ data: { id } }),
  });

function PendingClassroom() {
  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-8 space-y-4">
        <div className="h-4 w-32 rounded bg-muted animate-pulse" />
        <div className="h-8 w-64 rounded bg-muted animate-pulse" />
      </div>
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg bg-surface border border-border animate-pulse" />
        ))}
      </div>
      <div className="h-[600px] rounded-lg border border-border bg-surface animate-pulse" />
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/classrooms/$id")({
  head: () => ({ meta: [{ title: "Classroom — Kinetic" }] }),
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
  | "today" | "yesterday" | "week" | "month" | "streak" | "rank";

function ClassroomDetail() {
  const { id } = Route.useParams();
  const { data } = useSuspenseQuery(clsQO(id));
  const router = useRouter();
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
  const [refreshStartedAt, setRefreshStartedAt] = useState<number | null>(null);

  const updateStu = useServerFn(updateStudent);
  const editM = useMutation({
    mutationFn: (s: { id: string; name: string; roll: string; email: string; leetcode_id: string }) =>
      updateStu({ data: { id: s.id, name: s.name, roll: s.roll, email: s.email || null, leetcode_id: s.leetcode_id } }),
    onSuccess: () => {
      toast.success("Student updated");
      setEditingStudent(null);
      router.invalidate();
    },
    onError: (e) => toast.error(String(e)),
  });


  const refresh = useServerFn(refreshClassroom);
  const refreshM = useMutation({
    mutationFn: (force?: boolean) => {
      setRefreshStartedAt(Date.now());
      return refresh({ data: { id, force } });
    },
    onSuccess: (r) => {
      toast.success(`Refreshed ${r.ok} · ${r.failed} failed`);
      setRefreshStartedAt(null);
      router.invalidate();
    },
    onError: (e: any) => {
      const msg = String(e);
      if (msg.includes("REFRESH_BUSY")) {
        try {
          const parsed = JSON.parse(e.message);
          toast.error(`Another refresh is currently running (${parsed.busyClassroomName}).`, {
            action: {
              label: "Force Unlock",
              onClick: () => refreshM.mutate(true),
            },
          });
        } catch {
          toast.error("Another refresh is currently running. Please wait.");
        }
      } else {
        toast.error(msg);
      }
      setRefreshStartedAt(null);
    },
  });

  // Poll for live progress updates while refreshing
  useEffect(() => {
    if (!refreshM.isPending) return;
    const t = setInterval(() => {
      router.invalidate();
    }, 2000);
    return () => clearInterval(t);
  }, [refreshM.isPending, router]);

  const totalStudents = data.students.length;
  const processedCount = refreshStartedAt
    ? data.students.filter((s) => new Date(s.last_scraped_at ?? 0).getTime() > refreshStartedAt).length
    : 0;

  const qc = useQueryClient();
  const del = useServerFn(deleteClassroom);
  const delM = useMutation({
    mutationFn: () => del({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["classrooms"] });
      toast.success("Deleted");
      router.navigate({ to: "/dashboard" });
    },
    onError: (e) => toast.error(String(e)),
  });

  const rows = useMemo(
    () => data.students.map((s) => toStudentRow(s)),
    [data.students],
  );

  const counts = useMemo(() => bucketCounts(rows), [rows]);

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
          case "rank": return r.rank;
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

  const top10 = useMemo(() => [...rows].sort((a, b) => b.total - a.total).slice(0, 10), [rows]);

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
          <Button asChild variant="outline">
            <Link to="/classrooms/$id/students/new" params={{ id }}>
              <Plus className="mr-1 size-4" /> Add students
            </Link>
          </Button>
          <Button
            variant="outline"
            onClick={() => refreshM.mutate(false)}
            disabled={refreshM.isPending}
          >
            <RefreshCw className={cn("mr-1 size-4", refreshM.isPending && "animate-spin")} />
            {refreshM.isPending ? `Scraping… (${processedCount}/${totalStudents})` : "Refresh all"}
          </Button>
          <Button variant="outline" onClick={exportCsv} title="Export summary CSV (E)">
            <Download className="mr-1 size-4" /> Export summary
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">
                <Trash2 className="mr-1 size-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete classroom</AlertDialogTitle>
                <AlertDialogDescription>
                  Delete "{data.classroom.name}" and all its students? This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => delM.mutate()}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-5">
        <StatCard label="Students" value={rows.length} />
        <StatCard label="Cohort Total" value={cohort.total.toLocaleString()} />
        <StatCard label="Today" value={cohort.today} hint="submissions" />
        <StatCard label="This Week" value={cohort.week} hint="submissions" />
        <StatCard label="Avg / Student" value={cohort.avg} hint="lifetime solved" />
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
                <Line type="monotone" dataKey="solved" stroke={cPrimary} strokeWidth={2} dot={false} />
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
        <h3 className="mb-4 text-sm font-bold uppercase tracking-wider">Top 10 Students</h3>
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={top10}>
              <CartesianGrid stroke={cBorder} strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={9} stroke={cMutedFg} angle={-25} textAnchor="end" height={60} />
              <YAxis fontSize={10} stroke={cMutedFg} />
               <Tooltip contentStyle={{ background: cSurface, border: `1px solid ${cBorder}`, fontSize: 12, color: cMutedFg }} />
              <Bar dataKey="easy" stackId="a" fill={cEasy} />
              <Bar dataKey="medium" stackId="a" fill={cMedium} />
              <Bar dataKey="hard" stackId="a" fill={cHard} />
            </BarChart>
          </ResponsiveContainer>
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
                "rounded-lg border px-4 py-2 text-left transition-all",
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
                  <Th right onClick={() => toggleSort("rank")}>Rank</Th>
                  <th className="px-3 py-3 text-right">Edit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={14} className="px-4 py-16 text-center text-muted-foreground">
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
                      <td className="px-3 py-3 text-muted-foreground">{r.roll}</td>
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
                      <td className="px-3 py-3 text-right text-muted-foreground">
                        {s.stats?.ranking ? `#${s.stats.ranking.toLocaleString()}` : "—"}
                      </td>
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
                          className="inline-flex size-7 items-center justify-center rounded border border-transparent text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:border-border hover:bg-accent hover:text-foreground"
                        >
                          <Pencil className="size-3" />
                        </button>
                      </td>
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

      {/* Edit student modal */}
      {editingStudent && (
        <EditStudentModal
          student={editingStudent}
          onChange={setEditingStudent}
          onSave={() => editM.mutate(editingStudent)}
          onClose={() => setEditingStudent(null)}
          isPending={editM.isPending}
        />
      )}
    </div>
  );
}

function EditStudentModal({
  student,
  onChange,
  onSave,
  onClose,
  isPending,
}: {
  student: { id: string; name: string; roll: string; email: string; leetcode_id: string };
  onChange: (s: typeof student) => void;
  onSave: () => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const set = (k: keyof typeof student) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...student, [k]: e.target.value });

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Panel */}
      <div
        className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold">Edit Student</h2>
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
              {student.roll} · id: {student.id.slice(0, 8)}…
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid size-7 place-items-center rounded border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Fields */}
        <div className="space-y-4">
          <div>
            <Label htmlFor="edit-name">Name</Label>
            <Input id="edit-name" value={student.name} onChange={set("name")} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="edit-roll">Roll Number</Label>
            <Input id="edit-roll" value={student.roll} onChange={set("roll")} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="edit-email">Email <span className="text-muted-foreground">(optional)</span></Label>
            <Input id="edit-email" type="email" value={student.email} onChange={set("email")} className="mt-1" placeholder="student@college.edu" />
          </div>
          <div>
            <Label htmlFor="edit-lc">LeetCode Username</Label>
            <Input id="edit-lc" value={student.leetcode_id} onChange={set("leetcode_id")} className="mt-1" placeholder="leetcode_handle" />
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={isPending || !student.name || !student.roll || !student.leetcode_id}>
            {isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Th({
  children,
  onClick,
  right,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  right?: boolean;
  className?: string;
}) {
  return (
    <th
      onClick={onClick}
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

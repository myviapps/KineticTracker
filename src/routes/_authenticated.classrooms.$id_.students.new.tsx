import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Upload, FileText, ShieldAlert } from "lucide-react";

import { addStudent, bulkAddStudents, addStudentToClassroom } from "@/lib/students.functions";
import {
  parseCsvText,
  parseFile,
  templateCsv,
  PLATFORM_COLUMNS,
  type ParsedRow,
} from "@/lib/file-parser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useRole } from "@/hooks/use-role";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { SkeletonPageHeader } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { isFetchable, platformStatus, statusNote } from "@/lib/platform-capabilities";

/**
 * NOTE the `$id_` in this file's name. Without the trailing underscore the
 * generated route tree makes this a CHILD of `_authenticated.classrooms.$id`,
 * whose component renders no <Outlet /> — so navigating here re-rendered the
 * classroom detail page and the form below never mounted. The underscore opts
 * this route out of that parent layout while keeping the same URL.
 */
export const Route = createFileRoute("/_authenticated/classrooms/$id_/students/new")({
  head: () => ({ meta: [{ title: "Add students — Almanac" }] }),
  component: AddStudentsPage,
});

/**
 * A row this page can submit. `handles` is every NON-LeetCode platform.
 *
 * The CSV side no longer has its own parser. There used to be a `parseCsv` here
 * that understood exactly four fixed columns in a fixed order and silently
 * dropped anything else — so a file with a codeforces column imported as
 * LeetCode-only, and nobody found out until the platform tab was empty. The
 * shared parser in file-parser.ts already handles all ten platforms, header
 * aliases ("Roll No.", "cf handle") and .xlsx, so this uses that instead.
 */
type Row = {
  name: string;
  roll: string;
  email?: string;
  leetcode_id: string;
  handles?: Record<string, string>;
};

/** The platforms offered on the manual form, LeetCode excluded (own field). */
const OTHER_PLATFORMS = PLATFORM_COLUMNS.filter((p) => p.id !== "leetcode");

function toRows(parsed: ParsedRow[]): Row[] {
  return parsed
    .filter((r) => r.handles.leetcode)
    .map((r) => {
      const { leetcode, ...rest } = r.handles;
      return {
        name: r.name,
        roll: r.roll,
        email: r.email,
        leetcode_id: leetcode,
        handles: rest,
      };
    });
}

function AddStudentsPage() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  // Adding students is admin-or-assigned-faculty. This page sat under
  // `_authenticated` with no role check, so a placement officer could open the
  // form, fill it in and only then be told "Forbidden".
  const { canManageStudents, isLoading: roleLoading } = useRole();

  const add = useServerFn(addStudent);
  const bulk = useServerFn(bulkAddStudents);

  const [single, setSingle] = useState<Row>({
    name: "",
    roll: "",
    email: "",
    leetcode_id: "",
    handles: {},
  });
  const blankSingle = { name: "", roll: "", email: "", leetcode_id: "", handles: {} };

  const [csvText, setCsvText] = useState("");
  const [fileRows, setFileRows] = useState<Row[] | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);

  // A dropped .xlsx is parsed once and held; typed CSV re-parses as you type.
  const parsed = useMemo(() => {
    if (fileRows) return fileRows;
    if (!csvText.trim()) return [];
    const r = parseCsvText(csvText);
    return toRows(r.rows);
  }, [csvText, fileRows]);
  const preview = parsed;

  /** Which platform columns the pasted/uploaded file actually contained. */
  const detected = useMemo(() => {
    const ids = new Set<string>();
    for (const r of preview) {
      if (r.leetcode_id) ids.add("leetcode");
      for (const k of Object.keys(r.handles ?? {})) ids.add(k);
    }
    return PLATFORM_COLUMNS.filter((p) => ids.has(p.id));
  }, [preview]);

  /*
    A roll that already exists is no longer an error — it usually means the student
    is enrolled in another cohort and should be ADDED to this one. The server says
    which case it is; this asks before enrolling rather than doing it silently.
  */
  const [existing, setExisting] = useState<{
    id: string;
    name: string;
    leetcode_id: string;
    classrooms: string[];
    alreadyHere: boolean;
  } | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["classroom", id] });
    qc.invalidateQueries({ queryKey: ["classrooms"] });
    qc.invalidateQueries({ queryKey: ["overview"] });
  };

  const singleM = useMutation({
    mutationFn: () => {
      // Blank fields are "not on this platform", not an empty handle — sending
      // them would create accounts the worker then fails to fetch forever.
      const handles = Object.fromEntries(
        Object.entries(single.handles ?? {}).filter(([, v]) => v.trim().length > 0),
      );
      return add({ data: { classroom_id: id, ...single, handles } });
    },
    onSuccess: (r) => {
      if (r.status === "exists") {
        setExisting({ ...r.student, classrooms: r.classrooms, alreadyHere: r.alreadyHere });
        return;
      }
      const linked = Object.values(single.handles ?? {}).filter((v) => v.trim()).length;
      toast.success("Student added", {
        description: r.handleError
          ? `Profile queued, but a platform handle was rejected: ${r.handleError}`
          : linked > 0
            ? `${linked + 1} platform profiles queued and will fill in shortly.`
            : "Their LeetCode profile is queued and will fill in shortly.",
      });
      invalidate();
      setSingle(blankSingle);
    },
    onError: (e) => toast.error(String(e)),
  });

  const enroll = useServerFn(addStudentToClassroom);
  const enrollM = useMutation({
    mutationFn: (studentId: string) => enroll({ data: { studentId, classroomId: id } }),
    onSuccess: () => {
      toast.success("Added to this cohort", {
        description: "Their existing history comes with them.",
      });
      setExisting(null);
      invalidate();
      setSingle(blankSingle);
    },
    onError: (e) => toast.error(String(e)),
  });

  const bulkM = useMutation({
    mutationFn: () => bulk({ data: { classroom_id: id, rows: preview } }),
    onSuccess: (r) => {
      toast.success(`${r.inserted} new · ${r.enrolled} added from another cohort`, {
        description: r.skipped
          ? `${r.skipped} row${r.skipped === 1 ? "" : "s"} skipped: ${r.errors.map((e) => `${e.roll} (${e.reason})`).join("; ")}`
          : "Their profiles are queued for scraping.",
      });
      invalidate();
      nav({ to: "/classrooms/$id", params: { id } });
    },
    onError: (e) => toast.error(String(e)),
  });

  if (roleLoading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <SkeletonPageHeader />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  if (!canManageStudents) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <Link
          to="/classrooms/$id"
          params={{ id }}
          className="mb-4 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="size-3" /> Back to classroom
        </Link>
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <ShieldAlert className="mx-auto mb-3 size-8 text-muted-foreground" />
          <h1 className="text-lg font-bold">You can't add students</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Your role has read-only access to cohort data. Ask an admin, or the faculty member
            assigned to this classroom, to add students.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <Link
        to="/classrooms/$id"
        params={{ id }}
        className="mb-4 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="size-3" /> Back to classroom
      </Link>
      <h1 className="mb-2 text-2xl font-bold tracking-tight">Add students</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Add students one at a time, or paste a CSV / drop a spreadsheet. LeetCode is required; every
        other platform handle is optional and can be filled in later. Each profile is queued for
        scraping in the background.
      </p>

      <Tabs defaultValue="manual" className="w-full">
        <TabsList>
          <TabsTrigger value="manual">Manual</TabsTrigger>
          <TabsTrigger value="csv">
            <FileText className="mr-1 size-3.5" /> CSV upload
          </TabsTrigger>
        </TabsList>

        <TabsContent value="manual">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!single.name || !single.roll || !single.leetcode_id)
                return toast.error("Name, roll and LeetCode ID are required");
              singleM.mutate();
            }}
            className="space-y-4 rounded-lg border border-border bg-surface p-6"
          >
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={single.name}
                  onChange={(e) => setSingle({ ...single, name: e.target.value })}
                  placeholder="Jane Doe"
                  required
                />
              </div>
              <div>
                <Label htmlFor="roll">Roll</Label>
                <Input
                  id="roll"
                  value={single.roll}
                  onChange={(e) => setSingle({ ...single, roll: e.target.value })}
                  placeholder="CS-101-042"
                  required
                />
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={single.email ?? ""}
                  onChange={(e) => setSingle({ ...single, email: e.target.value })}
                  placeholder="jane@example.com"
                />
              </div>
              <div>
                <Label htmlFor="lc">LeetCode ID</Label>
                <Input
                  id="lc"
                  value={single.leetcode_id}
                  onChange={(e) => setSingle({ ...single, leetcode_id: e.target.value })}
                  placeholder="jane_dev"
                  required
                />
              </div>
            </div>

            {/*
              Every other platform. This form used to accept LeetCode alone, so a
              student added here could not be tracked anywhere else until somebody
              opened the edit dialog afterwards and filled them in one at a time —
              on an app that tracks five platforms.

              All optional: most students are not on every site, and demanding a
              value would only teach people to invent one.
            */}
            <div className="border-t border-border pt-4">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Other platforms
                </Label>
                <span className="font-mono text-[10px] text-muted-foreground">all optional</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {OTHER_PLATFORMS.map((p) => {
                  // Five of these platforms have no adapter (and SPOJ is blocked
                  // outright). The field still accepts a handle — storing it now
                  // means it works the day the adapter lands — but presenting it
                  // as an equal of Codeforces would promise a fetch that is not
                  // coming.
                  const fetchable = isFetchable(p.id);
                  return (
                    <div key={p.id} className="flex items-center gap-2">
                      <Label
                        htmlFor={`h-${p.id}`}
                        className={cn(
                          "w-24 shrink-0 truncate text-xs",
                          !fetchable && "text-muted-foreground",
                        )}
                        title={p.label}
                      >
                        {p.label}
                      </Label>
                      <div className="relative min-w-0 flex-1">
                        <Input
                          id={`h-${p.id}`}
                          value={single.handles?.[p.id] ?? ""}
                          onChange={(e) =>
                            setSingle({
                              ...single,
                              handles: { ...single.handles, [p.id]: e.target.value },
                            })
                          }
                          placeholder="handle"
                          className={cn("h-9 font-mono text-xs", !fetchable && "pr-20")}
                        />
                        {!fetchable && (
                          <span
                            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[9px] uppercase tracking-wider text-muted-foreground"
                            title={statusNote(p.id, platformStatus(p.id, false))}
                          >
                            not fetched
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                “not fetched” platforms have no scraper yet — the handle is saved and starts
                updating once one ships.
              </p>
            </div>

            <Button type="submit" disabled={singleM.isPending}>
              {singleM.isPending ? "Adding…" : "Add student"}
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="csv">
          <div className="space-y-4 rounded-lg border border-border bg-surface p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Label>CSV format</Label>
                <p className="mt-1 max-w-md text-xs text-muted-foreground">
                  <b>name</b> and <b>roll</b> are required, plus a <b>leetcode</b> handle. Add a
                  column per platform to import those too — headers are matched loosely, so “Roll
                  No.”, “cf handle” and “GFG” all work. <b>.xlsx</b> files are accepted.
                </p>
              </div>
              <a
                href={`data:text/csv;charset=utf-8,${encodeURIComponent(templateCsv())}`}
                download="students.csv"
                className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-primary hover:underline"
              >
                ↓ Template
              </a>
            </div>

            <div>
              <Label htmlFor="csv">Paste CSV</Label>
              <Textarea
                id="csv"
                value={csvText}
                onChange={(e) => {
                  setCsvText(e.target.value);
                  // Typing supersedes a previously dropped file.
                  setFileRows(null);
                  setParseErrors([]);
                }}
                rows={8}
                className="font-mono text-xs"
                placeholder={templateCsv()}
                spellCheck={false}
              />
              <div className="mt-2">
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls,text/csv"
                  className="text-xs"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    // Parsed through the shared parser so .xlsx works here too —
                    // the old FileReader path could only ever read plain text.
                    const res = await parseFile(f);
                    setCsvText("");
                    setFileRows(toRows(res.rows));
                    setParseErrors(res.errors);
                  }}
                />
              </div>
            </div>

            {parseErrors.length > 0 && (
              <div className="rounded border border-hard/40 bg-hard/5 p-3 text-xs text-hard">
                {parseErrors.join(" · ")}
              </div>
            )}

            {/* Which platform columns were recognised, BEFORE importing — a
                mistyped header is otherwise indistinguishable from an empty
                column, and you only find out once the handles are missing. */}
            {preview.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Handle columns found:
                </span>
                {detected.map((p) => (
                  <span
                    key={p.id}
                    className="rounded border border-easy/40 bg-easy/10 px-1.5 py-0.5 font-mono text-[10px] text-easy"
                  >
                    {p.label}
                  </span>
                ))}
              </div>
            )}

            {preview.length > 0 && (
              <div>
                <Label>Preview ({preview.length} rows)</Label>
                <div className="mt-1 max-h-64 overflow-auto rounded border border-border bg-background">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-surface-2 font-mono text-[10px] uppercase text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1.5">Name</th>
                        <th className="px-2 py-1.5">Roll</th>
                        <th className="px-2 py-1.5">Email</th>
                        {detected.map((p) => (
                          <th key={p.id} className="px-2 py-1.5">
                            {p.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border font-mono">
                      {preview.slice(0, 100).map((r, i) => (
                        <tr key={i}>
                          <td className="px-2 py-1.5">{r.name}</td>
                          <td className="px-2 py-1.5">{r.roll}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{r.email ?? "—"}</td>
                          {detected.map((p) => {
                            const v =
                              p.id === "leetcode" ? r.leetcode_id : (r.handles?.[p.id] ?? "");
                            return (
                              <td
                                key={p.id}
                                className={
                                  v
                                    ? "px-2 py-1.5 text-primary"
                                    : "px-2 py-1.5 text-muted-foreground"
                                }
                              >
                                {v || "—"}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <Button
              disabled={preview.length === 0 || bulkM.isPending}
              onClick={() => bulkM.mutate()}
            >
              <Upload className="mr-1 size-4" />
              {bulkM.isPending ? "Importing…" : `Import ${preview.length} students`}
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      {/* The discoverable path into "a student in two cohorts". */}
      <AlertDialog open={!!existing} onOpenChange={(o) => !o && setExisting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {existing?.alreadyHere ? "Already in this cohort" : "This student already exists"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Roll <span className="font-mono">{single.roll}</span> is{" "}
                  <b className="text-foreground">{existing?.name}</b>
                  {existing?.classrooms.length ? ` (${existing.classrooms.join(", ")})` : ""}.
                </p>
                <p>
                  {existing?.alreadyHere
                    ? "They are already on this roster — nothing to do."
                    : "Add them to this cohort as well? Their existing profile and scraped history come with them; nothing about their record is changed."}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{existing?.alreadyHere ? "Close" : "Cancel"}</AlertDialogCancel>
            {!existing?.alreadyHere && (
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  if (existing) enrollM.mutate(existing.id);
                }}
              >
                {enrollM.isPending ? "Adding…" : "Add to this cohort"}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

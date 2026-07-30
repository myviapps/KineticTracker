import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Upload, FileText, ShieldAlert } from "lucide-react";

import { addStudent, bulkAddStudents } from "@/lib/students.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useRole } from "@/hooks/use-role";
import { SkeletonPageHeader } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

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

type Row = { name: string; roll: string; email?: string; leetcode_id: string };

function parseCsv(text: string): Row[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].toLowerCase();
  const start = header.includes("name") && header.includes("roll") ? 1 : 0;
  const rows: Row[] = [];
  for (let i = start; i < lines.length; i++) {
    const cols = lines[i]
      .split(",")
      .map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cols.length < 3) continue;
    const [name, roll, third, fourth] = cols;
    if (cols.length >= 4) {
      rows.push({ name, roll, email: third, leetcode_id: fourth });
    } else {
      rows.push({ name, roll, leetcode_id: third });
    }
  }
  return rows;
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

  const [single, setSingle] = useState<Row>({ name: "", roll: "", email: "", leetcode_id: "" });
  const [csvText, setCsvText] = useState("");
  const preview = parseCsv(csvText);

  const singleM = useMutation({
    mutationFn: () => add({ data: { classroom_id: id, ...single } }),
    onSuccess: () => {
      toast.success("Student added", {
        description: "Their LeetCode profile is queued and will fill in shortly.",
      });
      qc.invalidateQueries({ queryKey: ["classroom", id] });
      qc.invalidateQueries({ queryKey: ["classrooms"] });
      setSingle({ name: "", roll: "", email: "", leetcode_id: "" });
    },
    onError: (e) => toast.error(String(e)),
  });

  const bulkM = useMutation({
    mutationFn: () => bulk({ data: { classroom_id: id, rows: preview } }),
    onSuccess: (r) => {
      toast.success(`${r.inserted} students added`, {
        description: "Their profiles are queued for scraping.",
      });
      qc.invalidateQueries({ queryKey: ["classroom", id] });
      qc.invalidateQueries({ queryKey: ["classrooms"] });
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
            Your role has read-only access to cohort data. Ask an admin, or the
            faculty member assigned to this classroom, to add students.
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
        Add students one at a time or paste a CSV. Each student's LeetCode profile is scraped
        immediately in the background.
      </p>

      <Tabs defaultValue="manual" className="w-full">
        <TabsList>
          <TabsTrigger value="manual">Manual</TabsTrigger>
          <TabsTrigger value="csv"><FileText className="mr-1 size-3.5" /> CSV upload</TabsTrigger>
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
                <Input id="name" value={single.name} onChange={(e) => setSingle({ ...single, name: e.target.value })} placeholder="Jane Doe" required />
              </div>
              <div>
                <Label htmlFor="roll">Roll</Label>
                <Input id="roll" value={single.roll} onChange={(e) => setSingle({ ...single, roll: e.target.value })} placeholder="CS-101-042" required />
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={single.email ?? ""} onChange={(e) => setSingle({ ...single, email: e.target.value })} placeholder="jane@example.com" />
              </div>
              <div>
                <Label htmlFor="lc">LeetCode ID</Label>
                <Input id="lc" value={single.leetcode_id} onChange={(e) => setSingle({ ...single, leetcode_id: e.target.value })} placeholder="jane_dev" required />
              </div>
            </div>
            <Button type="submit" disabled={singleM.isPending}>
              {singleM.isPending ? "Adding…" : "Add student"}
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="csv">
          <div className="space-y-4 rounded-lg border border-border bg-surface p-6">
            <div>
              <Label>CSV format</Label>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                Columns (with header row): <b>name,roll,email,leetcode_id</b> — or 3 columns
                without email: <b>name,roll,leetcode_id</b>.
              </p>
            </div>
            <div>
              <Label htmlFor="csv">Paste CSV</Label>
              <Textarea
                id="csv"
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                rows={10}
                className="font-mono text-xs"
                placeholder={"name,roll,email,leetcode_id\nJane Doe,CS-101-01,jane@x.com,jane_dev\nJohn Smith,CS-101-02,john@x.com,jsmith"}
              />
              <div className="mt-2">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="text-xs"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const reader = new FileReader();
                    reader.onload = () => setCsvText(String(reader.result ?? ""));
                    reader.readAsText(f);
                  }}
                />
              </div>
            </div>

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
                        <th className="px-2 py-1.5">LeetCode</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono divide-y divide-border">
                      {preview.slice(0, 100).map((r, i) => (
                        <tr key={i}>
                          <td className="px-2 py-1.5">{r.name}</td>
                          <td className="px-2 py-1.5">{r.roll}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{r.email ?? "—"}</td>
                          <td className="px-2 py-1.5 text-primary">{r.leetcode_id}</td>
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
    </div>
  );
}

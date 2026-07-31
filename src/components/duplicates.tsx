import { Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, GitMerge, Pencil, Trash2, TriangleAlert } from "lucide-react";

import {
  listDuplicateStudents,
  mergeStudents,
  type DuplicateGroup,
  type DuplicateStudent,
} from "@/lib/scrape-runs.functions";
import { updateStudent, deleteStudentCompletely } from "@/lib/students.functions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { AnimatedLoader } from "@/components/animated-loader";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export const DUPLICATES_KEY = ["duplicate-students"] as const;

/** Every roster-shaped cache is stale after a merge, edit or delete here. */
async function refreshAll(qc: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    qc.invalidateQueries({ queryKey: DUPLICATES_KEY }),
    qc.invalidateQueries({ queryKey: ["classrooms"] }),
    qc.invalidateQueries({ queryKey: ["classroom"] }),
    qc.invalidateQueries({ queryKey: ["overview"] }),
    qc.invalidateQueries({ queryKey: ["failed-students"] }),
  ]);
}

/**
 * `enabled` exists because this is an admin-only server function: calling it as
 * faculty returns Forbidden, which React Query would retry and surface as a toast
 * on a page they can otherwise use fine.
 */
export function useDuplicates(enabled = true) {
  return useQuery({
    queryKey: DUPLICATES_KEY,
    queryFn: () => listDuplicateStudents(),
    refetchInterval: 60_000,
    enabled,
  });
}

/**
 * Students colliding on an identity key.
 *
 * Two kinds, same problem. A shared ROLL is almost always the old
 * one-classroom-per-row workaround — the same person entered twice so they could
 * appear in two cohorts — which also means their LeetCode profile is scraped twice
 * into two divergent histories. A shared LEETCODE ID is a data-entry slip with the
 * same consequence.
 *
 * Both are fixed either by merging (same person) or by correcting one value
 * (different people), and only a human can tell which — so this offers both and
 * picks neither by default.
 */
export function Duplicates() {
  const { data: duplicates = [], isPending } = useDuplicates();

  if (isPending) return <AnimatedLoader text="Checking for duplicates…" />;

  if (duplicates.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-16 text-center">
        <CheckCircle2 className="mx-auto mb-3 size-8 text-easy" />
        <p className="text-sm font-medium">No duplicates.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Every roll number and every LeetCode ID belongs to exactly one student.
        </p>
      </div>
    );
  }

  const rolls = duplicates.filter((d) => d.kind === "roll");
  const handles = duplicates.filter((d) => d.kind === "leetcode_id");

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-medium/30 bg-medium/5 p-3 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-medium" />
        <div className="space-y-1 text-muted-foreground">
          {rolls.length > 0 && (
            <p>
              <span className="font-medium text-foreground">
                {rolls.length} roll number{rolls.length === 1 ? "" : "s"} used by more than one
                student.
              </span>{" "}
              These are usually the same person entered twice so they could appear in two cohorts.
              Merging gives you one student in both.
            </p>
          )}
          {handles.length > 0 && (
            <p>
              <span className="font-medium text-foreground">
                {handles.length} LeetCode ID{handles.length === 1 ? "" : "s"} shared by more than one
                student.
              </span>{" "}
              Each shared profile is scraped once per student and builds a separate history.
            </p>
          )}
          <p className="pt-1 text-xs">
            All of these must be resolved before the Phase 2 migration will run.
          </p>
        </div>
      </div>

      {rolls.length > 0 && (
        <>
          <h3 className="pt-2 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Duplicate roll numbers
          </h3>
          {rolls.map((d) => (
            <DuplicateCard key={`roll:${d.value}`} dupe={d} />
          ))}
        </>
      )}

      {handles.length > 0 && (
        <>
          <h3 className="pt-2 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Duplicate LeetCode IDs
          </h3>
          {handles.map((d) => (
            <DuplicateCard key={`handle:${d.value}`} dupe={d} />
          ))}
        </>
      )}
    </div>
  );
}

function DuplicateCard({ dupe }: { dupe: DuplicateGroup }) {
  const qc = useQueryClient();
  const merge = useServerFn(mergeStudents);

  // Default the survivor to the richest record, but never merge on that guess
  // alone — the choice is explicit and reversible right up to the confirm.
  const [survivorId, setSurvivorId] = useState(
    () => [...dupe.students].sort((a, b) => b.snapshot_count - a.snapshot_count)[0]?.id ?? "",
  );
  const [confirming, setConfirming] = useState<DuplicateStudent | null>(null);
  const [deleting, setDeleting] = useState<DuplicateStudent | null>(null);
  const [editing, setEditing] = useState<DuplicateStudent | null>(null);

  const mergeM = useMutation({
    mutationFn: (loserId: string) => merge({ data: { survivorId, loserId } }),
    onSuccess: async (r) => {
      setConfirming(null);
      await refreshAll(qc);
      toast.success("Students merged", {
        description: `${r.membershipsMoved} cohort${r.membershipsMoved === 1 ? "" : "s"} and ${r.snapshotsMoved} snapshot${r.snapshotsMoved === 1 ? "" : "s"} moved to the surviving record.`,
      });
    },
    onError: (e: unknown) => toast.error(String(e)),
  });

  const del = useServerFn(deleteStudentCompletely);
  const deleteM = useMutation({
    mutationFn: (studentId: string) => del({ data: { studentId } }),
    onSuccess: async (r) => {
      setDeleting(null);
      await refreshAll(qc);
      toast.success(`${r.roll} deleted`, {
        description:
          r.snapshotsDeleted > 0
            ? `${r.snapshotsDeleted} day${r.snapshotsDeleted === 1 ? "" : "s"} of history went with it.`
            : "That record had no scraped history.",
      });
    },
    onError: (e: unknown) => toast.error(String(e)),
  });

  const survivor = dupe.students.find((s) => s.id === survivorId);
  const isRoll = dupe.kind === "roll";

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background/60 px-4 py-2.5">
        <TriangleAlert className="size-4 shrink-0 text-medium" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {isRoll ? "Roll" : "LeetCode ID"}
        </span>
        <span className="font-mono text-sm font-bold">{dupe.value}</span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {dupe.student_count} students
        </span>
      </div>

      <div className="divide-y divide-border">
        {dupe.students.map((s) => {
          const isSurvivor = s.id === survivorId;
          const stored = (isRoll ? s.roll : s.leetcode_id).trim().toLowerCase();
          return (
            <div
              key={s.id}
              className={cn(
                "flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3",
                isSurvivor && "bg-primary/5",
              )}
            >
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name={`survivor-${dupe.kind}-${dupe.value}`}
                  checked={isSurvivor}
                  onChange={() => setSurvivorId(s.id)}
                  className="size-3.5 accent-[var(--primary)]"
                  aria-label={`Keep ${s.roll}`}
                />
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Keep
                </span>
              </label>

              <div className="min-w-[10rem] flex-1">
                <Link
                  to="/students/$roll"
                  params={{ roll: s.roll }}
                  className="text-sm font-medium hover:text-primary hover:underline"
                >
                  {s.name}
                </Link>
                <div className="font-mono text-[11px] text-muted-foreground">
                  {s.roll} · {s.leetcode_id}
                  {/* The scan matches case-insensitively but Phase 2's constraint
                      does not, so a case-only difference has to be visible here or
                      it survives the migration as two students on one profile. */}
                  {stored !== dupe.value && (
                    <span className="ml-1.5 text-medium">differs only by case</span>
                  )}
                </div>
              </div>

              <div className="font-mono text-[11px] text-muted-foreground">
                {s.classrooms.length > 0 ? s.classrooms.join(" · ") : "no cohort"}
              </div>

              <div className="flex gap-4 font-mono text-[11px] tabular-nums text-muted-foreground">
                <span title="Problems solved">{s.total_solved} solved</span>
                <span title="Days of snapshot history">{s.snapshot_count} snapshots</span>
                <span title="Last scraped">
                  {s.last_scraped_at ? new Date(s.last_scraped_at).toLocaleDateString() : "never"}
                </span>
              </div>

              <div className="ml-auto flex gap-1">
                {/* Edits in place. This used to link to the student profile, which
                    is a read-only page — you had to go there, find the edit control
                    on the classroom page instead, fix it, and come back. */}
                <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                  <Pencil className="mr-1 size-3.5" />
                  {isRoll ? "Fix roll" : "Fix handle"}
                </Button>
                {!isSurvivor && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-hard hover:bg-hard/10 hover:text-hard"
                    onClick={() => setConfirming(s)}
                    disabled={mergeM.isPending || !survivor}
                  >
                    <GitMerge className="mr-1 size-3.5" />
                    Merge into {survivor?.roll ?? "…"}
                  </Button>
                )}
                {!isSurvivor && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-hard hover:bg-hard/10 hover:text-hard"
                    onClick={() => setDeleting(s)}
                    disabled={deleteM.isPending}
                    title="Delete this record and everything attached to it"
                  >
                    <Trash2 className="size-3.5" />
                    <span className="sr-only">Delete {s.roll}</span>
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Fix the colliding value without leaving the screen. */}
      {editing && (
        <EditDuplicateDialog
          student={editing}
          kind={dupe.kind}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refreshAll(qc);
          }}
        />
      )}

      {/*
        Delete throws the record's history away; merge keeps it. The dialog leads
        with whichever of those is the bigger deal for THIS row — a duplicate with
        180 days of snapshots is almost certainly a merge, not a delete.
      */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleting?.roll} — {deleting?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  This removes the record from{" "}
                  {deleting?.classrooms.length
                    ? `${deleting.classrooms.join(", ")}`
                    : "every cohort"}{" "}
                  and permanently deletes{" "}
                  <b className="text-hard">
                    {deleting?.snapshot_count ?? 0} day
                    {(deleting?.snapshot_count ?? 0) === 1 ? "" : "s"} of scraped history
                  </b>
                  . It cannot be undone.
                </p>
                {(deleting?.snapshot_count ?? 0) > 0 && (
                  <p className="rounded-md bg-medium/10 px-2 py-1.5 text-[12px] text-muted-foreground">
                    This record has history. If it is the same person as{" "}
                    {survivor?.roll ?? "the one you kept"}, <b>merge instead</b> — that folds
                    the history in rather than discarding it.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && deleteM.mutate(deleting.id)}
              className="bg-hard text-white hover:bg-hard/90"
            >
              {deleteM.isPending ? "Deleting…" : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/*
        Merging deletes the loser permanently, so the dialog names both records and
        states what happens to the history rather than asking a generic "are you
        sure". This is the only gate.
      */}
      <AlertDialog open={!!confirming} onOpenChange={(o) => !o && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Merge {confirming?.roll} into {survivor?.roll}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  <b className="text-foreground">{survivor?.name}</b> ({survivor?.roll}) is kept and
                  gains every cohort and every day of history from{" "}
                  <b className="text-foreground">{confirming?.name}</b> ({confirming?.roll}).
                </p>
                <p>
                  <b className="text-hard">{confirming?.roll} is then deleted permanently.</b> This
                  cannot be undone. If these are two different people, close this and correct one of
                  the LeetCode IDs instead.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirming && mergeM.mutate(confirming.id)}
              className="bg-hard text-white hover:bg-hard/90"
            >
              {mergeM.isPending ? "Merging…" : "Merge and delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Minimal editor for resolving a collision in place.
 *
 * Deliberately focused: the field that collides is autofocused and explained, and
 * the others are here only because fixing a typo'd roll usually means the name is
 * wrong too. `updateStudent` re-checks everything server-side — this cannot bypass
 * the handle-uniqueness check.
 */
function EditDuplicateDialog({
  student,
  kind,
  onClose,
  onSaved,
}: {
  student: DuplicateStudent;
  kind: DuplicateGroup["kind"];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [form, setForm] = useState({
    name: student.name,
    roll: student.roll,
    email: student.email ?? "",
    leetcode_id: student.leetcode_id,
  });

  const update = useServerFn(updateStudent);
  const saveM = useMutation({
    mutationFn: () =>
      update({
        data: {
          id: student.id,
          name: form.name,
          roll: form.roll,
          // Carried through, not defaulted. updateStudent writes every field it is
          // given, so omitting this would silently blank the student's email.
          email: form.email || null,
          leetcode_id: form.leetcode_id,
        },
      }),
    onSuccess: async () => {
      toast.success(`${form.roll} updated`);
      await onSaved();
    },
    onError: (e: unknown) => toast.error(String(e)),
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const changed =
    form.name !== student.name ||
    form.roll !== student.roll ||
    form.email !== (student.email ?? "") ||
    form.leetcode_id !== student.leetcode_id;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Fix {kind === "roll" ? "roll number" : "LeetCode ID"}</DialogTitle>
          <DialogDescription>
            {kind === "roll"
              ? "Give this student their own roll number, or close this and merge if it is the same person."
              : "Point this student at their own LeetCode profile, or close this and merge if it is the same person."}
          </DialogDescription>
        </DialogHeader>

        <form
          id="fix-duplicate-form"
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (changed && !saveM.isPending) saveM.mutate();
          }}
        >
          <div>
            <Label htmlFor="dup-roll">Roll number</Label>
            <Input
              id="dup-roll"
              value={form.roll}
              onChange={set("roll")}
              className="mt-1 font-mono"
              autoFocus={kind === "roll"}
              required
            />
          </div>
          <div>
            <Label htmlFor="dup-handle">LeetCode ID</Label>
            <Input
              id="dup-handle"
              value={form.leetcode_id}
              onChange={set("leetcode_id")}
              className="mt-1 font-mono"
              autoFocus={kind === "leetcode_id"}
              required
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Stored lowercase — one student, one profile.
            </p>
          </div>
          <div>
            <Label htmlFor="dup-name">Name</Label>
            <Input id="dup-name" value={form.name} onChange={set("name")} className="mt-1" required />
          </div>
          <div>
            <Label htmlFor="dup-email">Email</Label>
            <Input
              id="dup-email"
              type="email"
              value={form.email}
              onChange={set("email")}
              className="mt-1"
              placeholder="optional"
            />
          </div>
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saveM.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="fix-duplicate-form" disabled={!changed || saveM.isPending}>
            {saveM.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Users2 } from "lucide-react";

import { getStudentHandles } from "@/lib/students.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Edit a student's identity and platform handles.
 *
 * Lives here rather than inside the classroom route because the student
 * profile needs the same editor. Duplicating it would mean two forms that
 * disagree about what a handle change means — and the handle reconciler is
 * exactly the part that must not drift.
 *
 * The cohort-transfer props are optional: the classroom page knows which
 * cohort you are moving OUT of, the profile page does not, so it simply
 * omits them and the section does not render.
 */
export function EditStudentModal({
  student,
  shared,
  canAdminister,
  otherClassrooms,
  onMove,
  isMoving,
  onChange,
  onSave,
  onClose,
  isPending,
}: {
  student: { id: string; name: string; roll: string; email: string; leetcode_id: string };
  /** True when this student belongs to more than one cohort. */
  shared: boolean;
  /** Roll number stays admin-only for shared students; LeetCode ID doesn't. */
  canAdminister: boolean;
  /**
   * Every cohort except the one being viewed. Omitted entirely by callers with
   * no cohort context (the student profile), which hides the transfer section.
   * Empty for non-admins, which hides it too.
   */
  otherClassrooms?: { id: string; name: string }[];
  onMove?: (toClassroomId: string, mode: "move" | "add") => void;
  isMoving?: boolean;
  onChange: (s: typeof student) => void;
  onSave: (handles?: Record<string, string>) => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const set = (k: keyof typeof student) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...student, [k]: e.target.value });

  /*
    Handles are loaded here rather than passed in. The cohort payload only knows
    about platforms that have been fetched successfully, so a freshly-typed or
    permanently-failing handle would not appear in it — and an editor that shows
    a blank field for a handle that exists will erase it on save.
  */
  const loadHandles = useServerFn(getStudentHandles);
  const { data: handleData, isLoading: handlesLoading } = useQuery({
    queryKey: ["student-handles", student.id],
    queryFn: () => loadHandles({ data: { id: student.id } }),
  });

  // platform id -> edited value. Only platforms the user actually touched, so an
  // untouched platform is never written and cannot have its fetch state reset.
  const [edited, setEdited] = useState<Record<string, string>>({});

  /** Cohort chosen in the transfer picker below. "" = nothing selected yet. */
  const [moveTarget, setMoveTarget] = useState("");

  const rows = (handleData?.handles ?? []).filter((h) => h.platform_id !== "leetcode");
  const valueFor = (platformId: string, original: string) => edited[platformId] ?? original;

  const dirtyHandles = Object.keys(edited).length > 0 ? edited : undefined;

  const canSave = !!student.name && !!student.roll && !!student.leetcode_id;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Student</DialogTitle>
          <DialogDescription className="font-mono text-[10px]">
            {student.roll} · id: {student.id.slice(0, 8)}…
          </DialogDescription>
          {shared && (
            <p className="flex items-start gap-1.5 rounded-md bg-medium/10 px-2 py-1.5 text-left text-[11px] text-muted-foreground">
              <Users2 className="mt-px size-3.5 shrink-0 text-medium" />
              <span>
                Also in other cohorts — changes apply everywhere. Roll number is admin-only for
                shared students.
              </span>
            </p>
          )}
        </DialogHeader>

        <form
          id="edit-student-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave && !isPending) onSave(dirtyHandles);
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              value={student.name}
              onChange={set("name")}
              className="mt-1"
              required
            />
          </div>
          <div>
            <Label htmlFor="edit-roll">Roll Number</Label>
            <Input
              id="edit-roll"
              value={student.roll}
              onChange={set("roll")}
              className="mt-1"
              required
              disabled={shared && !canAdminister}
              title={
                shared && !canAdminister
                  ? "Admin-only: this student is in more than one cohort"
                  : undefined
              }
            />
          </div>
          <div>
            <Label htmlFor="edit-email">
              Email <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="edit-email"
              type="email"
              value={student.email}
              onChange={set("email")}
              className="mt-1"
              placeholder="student@college.edu"
            />
          </div>
          <div>
            <Label htmlFor="edit-lc">LeetCode Username</Label>
            <Input
              id="edit-lc"
              value={student.leetcode_id}
              onChange={set("leetcode_id")}
              className="mt-1"
              placeholder="leetcode_handle"
              required
            />
          </div>

          {/* Other platforms. LeetCode is excluded from this list on purpose —
              it has its own field above, and students.leetcode_id is still its
              source of truth (a trigger mirrors it into the accounts table). */}
          <div className="border-t border-border pt-3">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Other platforms
              </Label>
              <span className="font-mono text-[10px] text-muted-foreground">
                clear a field to unlink
              </span>
            </div>

            {handlesLoading && (
              <div className="space-y-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            )}

            {!handlesLoading && rows.length === 0 && (
              <p className="text-xs text-muted-foreground">No other platform is enabled yet.</p>
            )}

            <div className="space-y-2">
              {rows.map((h) => {
                const value = valueFor(h.platform_id, h.handle);
                const changed = value.trim() !== h.handle.trim();
                return (
                  <div key={h.platform_id} className="flex items-center gap-2">
                    <Label
                      htmlFor={`edit-${h.platform_id}`}
                      className="w-28 shrink-0 truncate text-xs"
                      title={h.platform_name}
                    >
                      {h.platform_name}
                    </Label>
                    <div className="relative min-w-0 flex-1">
                      <Input
                        id={`edit-${h.platform_id}`}
                        value={value}
                        onChange={(e) =>
                          setEdited((p) => ({ ...p, [h.platform_id]: e.target.value }))
                        }
                        placeholder={h.refreshable ? "handle" : "handle (not fetched yet)"}
                        className={cn("h-9 pr-16 font-mono text-xs", changed && "border-primary")}
                      />
                      {/* Fetch state, so a handle that looks fine but keeps
                          failing explains itself rather than just showing no data. */}
                      <span
                        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[9px] uppercase tracking-wider"
                        title={h.fetch_error ?? undefined}
                      >
                        {changed ? (
                          <span className="text-primary">edited</span>
                        ) : h.status === "active" ? (
                          <span className="text-easy">ok</span>
                        ) : h.status === "invalid_handle" ? (
                          <span className="text-hard">not found</span>
                        ) : h.status === "blocked" ? (
                          <span className="text-medium">blocked</span>
                        ) : h.handle ? (
                          <span className="text-muted-foreground">pending</span>
                        ) : null}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </form>

        {/*
          Cohort transfer. Outside the form on purpose: it is its own mutation
          that commits immediately, and nesting it would make "Save changes"
          look like it also applied the move.

          Admin-only, mirroring the server gate — this reaches into cohorts the
          caller may be the only one able to see.
        */}
        {canAdminister && onMove && (otherClassrooms?.length ?? 0) > 0 && (
          <div className="border-t border-border pt-3">
            <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Cohort
            </Label>
            <p className="mb-2 mt-1 text-[11px] text-muted-foreground">
              Move takes them out of this cohort. Add keeps both — a student can belong to several.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={moveTarget}
                onChange={(e) => setMoveTarget(e.target.value)}
                disabled={isMoving}
                className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="">Select a cohort…</option>
                {(otherClassrooms ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!moveTarget || isMoving}
                onClick={() => onMove(moveTarget, "add")}
              >
                Add
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!moveTarget || isMoving}
                onClick={() => onMove(moveTarget, "move")}
              >
                {isMoving ? "Working…" : "Move"}
              </Button>
            </div>
          </div>
        )}

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

import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { UserPlus, Trash2, Unlock, Link as LinkIcon, Unlink, Key } from "lucide-react";

import { listStaff, createStaffUser, deactivateUser, assignFacultyToClassroom, unassignFaculty, forceReleaseRefreshLock, resetStaffPassword } from "@/lib/staff.functions";
import { listClassrooms } from "@/lib/classrooms.functions";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
  AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionTitle } from "@/components/stat-card";
import { SkeletonRows } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/_admin/staff")({
  head: () => ({ meta: [{ title: "Staff Management — Almanac" }] }),
  component: StaffPage,
});

function StaffPage() {
  const router = useRouter();
  const qc = useQueryClient();

  // `isPending` is used below instead of relying on the `= []` default: this page
  // rendered "No staff accounts yet" during the very first fetch, which reads as
  // "you have no staff" rather than "still loading".
  const { data: staffList = [], isPending: staffLoading } = useQuery({
    queryKey: ["staff"],
    queryFn: () => listStaff(),
  });

  const { data: classrooms = [], isPending: classroomsLoading } = useQuery({
    queryKey: ["classrooms"],
    queryFn: () => listClassrooms(),
  });

  // Create staff form
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"faculty" | "placement_officer">("faculty");
  const [selectedClassrooms, setSelectedClassrooms] = useState<string[]>([]);

  const create = useServerFn(createStaffUser);
  const createM = useMutation({
    mutationFn: () => create({ data: { email, name, role, classroom_ids: role === "faculty" ? selectedClassrooms : undefined } }),
    onSuccess: (res) => {
      toast.success(`Account created. Temporary password: ${res.tempPassword}`, {
        description: "Copy it now — it is shown only once. Share it securely and have them change it after signing in.",
        duration: Infinity,
        closeButton: true,
      });
      qc.invalidateQueries({ queryKey: ["staff"] });
      setEmail(""); setName(""); setRole("faculty"); setSelectedClassrooms([]);
    },

    onError: (e) => toast.error(String(e)),
  });

  const deactivate = useServerFn(deactivateUser);
  const deactivateM = useMutation({
    mutationFn: (userId: string) => deactivate({ data: { user_id: userId } }),
    onSuccess: () => {
      toast.success("User deactivated");
      qc.invalidateQueries({ queryKey: ["staff"] });
    },
    onError: (e) => toast.error(String(e)),
  });

  const resetPw = useServerFn(resetStaffPassword);
  const resetPwM = useMutation({
    mutationFn: (args: { userId: string }) => resetPw({ data: { user_id: args.userId } }),
    // The old copy claimed the password had been set to the user's email address.
    // It never was — it was a hardcoded shared literal. It is now random per reset,
    // so it has to be shown, once, and copied.
    onSuccess: (res) => {
      toast.success("Password reset", {
        description: `New temporary password: ${res.tempPassword} — copy it now, it is shown only once. Have them change it after signing in.`,
        duration: Infinity,
        closeButton: true,
      });
    },
    onError: (e) => toast.error(String(e)),
  });

  const assign = useServerFn(assignFacultyToClassroom);
  const assignM = useMutation({
    mutationFn: ({ facultyUserId, classroomId }: { facultyUserId: string; classroomId: string }) =>
      assign({ data: { faculty_user_id: facultyUserId, classroom_id: classroomId } }),
    onSuccess: () => {
      toast.success("Assigned");
      qc.invalidateQueries({ queryKey: ["staff"] });
    },
    onError: (e) => toast.error(String(e)),
  });

  const unassign = useServerFn(unassignFaculty);
  const unassignM = useMutation({
    mutationFn: ({ facultyUserId, classroomId }: { facultyUserId: string; classroomId: string }) =>
      unassign({ data: { faculty_user_id: facultyUserId, classroom_id: classroomId } }),
    onSuccess: () => {
      toast.success("Unassigned");
      qc.invalidateQueries({ queryKey: ["staff"] });
    },
    onError: (e) => toast.error(String(e)),
  });

  const forceRelease = useServerFn(forceReleaseRefreshLock);
  const forceReleaseM = useMutation({
    mutationFn: () => forceRelease(),
    onSuccess: () => toast.success("Refresh lock released"),
    onError: (e) => toast.error(String(e)),
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-8">
        <h1 className="font-mono text-xs uppercase tracking-[0.25em] text-primary">
          Almanac / Admin
        </h1>
        <h2 className="mt-2 text-3xl font-bold tracking-tight">Staff Management</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Create faculty and placement officer accounts, assign classrooms, and manage refresh locks.
        </p>
      </div>

      {/* Create staff form */}
      <div className="mb-10 rounded-lg border border-border bg-surface p-6">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
          <UserPlus className="size-4" /> Create Staff Account
        </h3>
        <form
          onSubmit={(e) => { e.preventDefault(); createM.mutate(); }}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <Label htmlFor="staff-email">Email</Label>
              <Input id="staff-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="faculty@college.edu" required />
            </div>
            <div>
              <Label htmlFor="staff-name">Name</Label>
              <Input id="staff-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr. Jane Smith" required />
            </div>
            <div>
              <Label htmlFor="staff-role">Role</Label>
              <Select value={role} onValueChange={(v: "faculty" | "placement_officer") => setRole(v)}>
                <SelectTrigger id="staff-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="faculty">Faculty</SelectItem>
                  <SelectItem value="placement_officer">Placement Officer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {role === "faculty" && (
            <div>
              <Label>Assign Classrooms</Label>
              <div className="mt-1 max-h-40 overflow-y-auto rounded border border-border bg-background p-2">
                {classroomsLoading &&
                  Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="mx-2 my-1.5 h-4 w-40" />
                  ))}
                {!classroomsLoading && classrooms.length === 0 && (
                  <p className="p-2 text-xs text-muted-foreground">No classrooms yet.</p>
                )}
                {classrooms.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedClassrooms.includes(c.id)}
                      onChange={(e) => {
                        setSelectedClassrooms(
                          e.target.checked
                            ? [...selectedClassrooms, c.id]
                            : selectedClassrooms.filter((id) => id !== c.id),
                        );
                      }}
                      className="rounded"
                    />
                    {c.name} ({c.student_count} students)
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={createM.isPending}>
              {createM.isPending ? "Creating…" : "Create staff account"}
            </Button>
          </div>
        </form>
      </div>

      {/* Existing staff */}
      <SectionTitle>Staff Accounts</SectionTitle>
      {staffLoading ? (
        <SkeletonRows rows={3} />
      ) : (
      <div className="space-y-3">
        {staffList.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No staff accounts yet.
          </div>
        )}
        {staffList.map((s) => (
          <div key={s.user_id} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{s.email}</span>
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-primary">
                    {s.role}
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                {s.role === "faculty" && classrooms.map((c) => {
                  const assigned = s.classroom_ids.includes(c.id);
                  if (assigned) {
                    return (
                      <AlertDialog key={c.id}>
                        <AlertDialogTrigger asChild>
                          <button
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium bg-primary/10 text-primary"
                            title={`Click to unassign ${c.name}`}
                          >
                            <LinkIcon className="size-3" /> {c.name}
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Unassign classroom?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Unassign {c.name} from {s.email}?
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => unassignM.mutate({ facultyUserId: s.user_id, classroomId: c.id })}>
                              Unassign
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    );
                  }
                  return (
                    <button
                      key={c.id}
                      onClick={() => assignM.mutate({ facultyUserId: s.user_id, classroomId: c.id })}
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium bg-muted text-muted-foreground hover:bg-accent"
                      title={`Click to assign ${c.name}`}
                    >
                      <Unlink className="size-3" /> {c.name}
                    </button>
                  );
                })}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" title="Generate a new temporary password">
                      <Key className="size-3" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Reset password?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This generates a new random temporary password for {s.email} and
                        invalidates their current one. It will be shown to you once —
                        copy it and share it securely.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => resetPwM.mutate({ userId: s.user_id })}>
                        Reset
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm">
                      <Trash2 className="size-3" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete account?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This permanently deletes {s.email}, their role and their classroom
                        assignments. It cannot be undone. You cannot delete your own
                        account or the last remaining admin.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deactivateM.mutate(s.user_id)}>
                        Delete account
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </div>
        ))}
      </div>
      )}

      {/* Force-release refresh lock */}
      <div className="mt-10 rounded-lg border border-hard/30 bg-hard/5 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold">Refresh Lock</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              If a refresh job is stuck (e.g. the worker crashed), you can force-release the global lock here.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => forceReleaseM.mutate()}
            disabled={forceReleaseM.isPending}
          >
            <Unlock className="mr-1 size-3" /> Force release lock
          </Button>
        </div>
      </div>
    </div>
  );
}

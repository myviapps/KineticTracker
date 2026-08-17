import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Building2,
  Key,
  Layers,
  MoreVertical,
  Plus,
  ShieldCheck,
  Trash2,
  Unlock,
  UserPlus,
} from "lucide-react";

import {
  listStaff,
  createStaffUser,
  deactivateUser,
  setCollegeAssignment,
  assignFacultyToClassroom,
  unassignFaculty,
  forceReleaseRefreshLock,
  resetStaffPassword,
} from "@/lib/staff.functions";
import { listClassrooms } from "@/lib/classrooms.functions";
import { listColleges } from "@/lib/colleges.functions";
import { ClassroomPicker, type PickerClassroom } from "@/components/classroom-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SkeletonRows } from "@/components/skeletons";

export const Route = createFileRoute("/_authenticated/_admin/staff")({
  head: () => ({ meta: [{ title: "Staff — Almanac" }] }),
  component: StaffPage,
});

type StaffRole = "admin" | "ceo" | "placement_officer" | "faculty";

/**
 * What each role means, in one place.
 *
 * The four roles are not variations on a theme — they are scoped by three
 * DIFFERENT mechanisms. Admin has no scope at all, CEO and placement officer
 * are scoped by college, faculty by individual classroom. The old page rendered
 * all four through one row template with a classroom picker bolted on, so the
 * shape of someone's access was invisible: you could not tell from the screen
 * whether a person saw one cohort or the entire platform.
 *
 * `scope` is what drives the access column below.
 */
const ROLE_META: Record<
  StaffRole,
  { label: string; scope: "none" | "colleges" | "classrooms"; blurb: string }
> = {
  admin: {
    label: "Admin",
    scope: "none",
    blurb: "Everything, everywhere. Can create other admins.",
  },
  ceo: {
    label: "CEO",
    scope: "colleges",
    blurb: "Read-only across the colleges assigned to them.",
  },
  placement_officer: {
    label: "Placement",
    scope: "colleges",
    blurb: "Read-only. Platform-wide until a college is assigned.",
  },
  faculty: {
    label: "Faculty",
    scope: "classrooms",
    blurb: "Manages students in their assigned cohorts.",
  },
};

const ROLE_ORDER: StaffRole[] = ["admin", "ceo", "placement_officer", "faculty"];

function StaffPage() {
  const qc = useQueryClient();

  // `isPending` rather than the `= []` default: this page rendered "No staff
  // accounts yet" during the first fetch, which reads as a fact rather than a
  // loading state.
  const { data: staffList = [], isPending: staffLoading } = useQuery({
    queryKey: ["staff"],
    queryFn: () => listStaff(),
  });

  const { data: classroomData, isPending: classroomsLoading } = useQuery({
    queryKey: ["classrooms"],
    queryFn: () => listClassrooms(),
  });
  const classrooms: PickerClassroom[] = classroomData?.classrooms ?? [];

  const { data: collegeData } = useQuery({
    queryKey: ["colleges"],
    queryFn: () => listColleges(),
    staleTime: 5 * 60_000,
  });
  const colleges = useMemo(
    () => (collegeData?.colleges ?? []).map((c) => ({ id: c.college_id, name: c.college_name })),
    [collegeData],
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [roleFilter, setRoleFilter] = useState<StaffRole | "all">("all");

  /** Confirmations live outside the row menu — a dialog inside a dropdown loses focus when the menu unmounts. */
  const [confirm, setConfirm] = useState<{
    kind: "reset" | "delete";
    userId: string;
    email: string;
  } | null>(null);

  const counts = useMemo(() => {
    const by = { admin: 0, ceo: 0, placement_officer: 0, faculty: 0 } as Record<StaffRole, number>;
    for (const s of staffList) if (s.role in by) by[s.role as StaffRole] += 1;
    return by;
  }, [staffList]);

  const visible = useMemo(
    () =>
      [...staffList]
        .filter((s) => roleFilter === "all" || s.role === roleFilter)
        // Most privileged first, then alphabetical — the list reads as a
        // hierarchy of reach rather than an arbitrary insertion order.
        .sort((a, b) => {
          const ra = ROLE_ORDER.indexOf(a.role as StaffRole);
          const rb = ROLE_ORDER.indexOf(b.role as StaffRole);
          return ra !== rb ? ra - rb : a.email.localeCompare(b.email);
        }),
    [staffList, roleFilter],
  );

  const settleStaff = () => qc.invalidateQueries({ queryKey: ["staff"] });

  const assign = useServerFn(assignFacultyToClassroom);
  const assignM = useMutation({
    mutationFn: (v: { userId: string; classroomId: string }) =>
      assign({ data: { faculty_user_id: v.userId, classroom_id: v.classroomId } }),
    onSuccess: (r) => {
      if (r?.crossCollege) {
        toast.warning(`Assigned ${r.classroomName} — a different college to their other cohorts`, {
          description: "They can now see that college's students, rankings and reports.",
        });
      } else {
        toast.success("Cohort assigned");
      }
      settleStaff();
    },
    onError: (e) => toast.error(String(e)),
  });

  const unassign = useServerFn(unassignFaculty);
  const unassignM = useMutation({
    mutationFn: (v: { userId: string; classroomId: string }) =>
      unassign({ data: { faculty_user_id: v.userId, classroom_id: v.classroomId } }),
    onSuccess: () => {
      toast.success("Cohort unassigned");
      settleStaff();
    },
    onError: (e) => toast.error(String(e)),
  });

  const setCollege = useServerFn(setCollegeAssignment);
  const collegeM = useMutation({
    mutationFn: (v: { userId: string; collegeId: string; assigned: boolean }) =>
      setCollege({ data: { user_id: v.userId, college_id: v.collegeId, assigned: v.assigned } }),
    onSuccess: (_r, v) => {
      toast.success(v.assigned ? "College assigned" : "College unassigned");
      settleStaff();
    },
    onError: (e) => toast.error(String(e)),
  });

  const resetPw = useServerFn(resetStaffPassword);
  const resetPwM = useMutation({
    mutationFn: (userId: string) => resetPw({ data: { user_id: userId } }),
    onSuccess: (r) => {
      toast.success(`Temporary password: ${r.tempPassword}`, {
        description: "Shown once. Copy it now and share it securely.",
        duration: Infinity,
        closeButton: true,
      });
      setConfirm(null);
    },
    onError: (e) => toast.error(String(e)),
  });

  const deactivate = useServerFn(deactivateUser);
  const deactivateM = useMutation({
    mutationFn: (userId: string) => deactivate({ data: { user_id: userId } }),
    onSuccess: () => {
      toast.success("Account deleted");
      setConfirm(null);
      settleStaff();
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
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-mono text-xs uppercase tracking-[0.25em] text-primary">
            Almanac / Admin
          </h1>
          <h2 className="mt-2 text-3xl font-bold tracking-tight">Staff</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Who can sign in, and what each of them can reach.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <UserPlus className="mr-1 size-4" /> Add staff
        </Button>
      </div>

      {/*
        Role filter as counts, not decoration: the tally IS the answer to "how
        is access distributed here", and it doubles as the filter. An empty role
        still shows, because zero CEOs is information.
      */}
      <div className="mb-5 flex flex-wrap gap-1.5">
        <RoleChip
          active={roleFilter === "all"}
          onClick={() => setRoleFilter("all")}
          label="Everyone"
          count={staffList.length}
        />
        {ROLE_ORDER.map((r) => (
          <RoleChip
            key={r}
            active={roleFilter === r}
            onClick={() => setRoleFilter(r)}
            label={ROLE_META[r].label}
            count={counts[r]}
          />
        ))}
      </div>

      {staffLoading && <SkeletonRows rows={4} />}

      {!staffLoading && visible.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-16 text-center">
          <p className="text-sm text-muted-foreground">
            {staffList.length === 0
              ? "No staff accounts yet. Add one to give someone access."
              : `No ${roleFilter === "all" ? "" : ROLE_META[roleFilter as StaffRole].label} accounts.`}
          </p>
        </div>
      )}

      {!staffLoading && visible.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <div className="hidden grid-cols-[minmax(14rem,1.1fr)_8rem_minmax(16rem,1.4fr)_2.5rem] gap-4 border-b border-border bg-background/60 px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground md:grid">
            <span>Person</span>
            <span>Role</span>
            <span>Can reach</span>
            <span className="sr-only">Actions</span>
          </div>

          <div className="divide-y divide-border">
            {visible.map((s) => {
              const meta = ROLE_META[s.role as StaffRole];
              return (
                <div
                  key={s.id}
                  className="grid grid-cols-1 gap-3 px-4 py-3 transition-colors hover:bg-primary/5 md:grid-cols-[minmax(14rem,1.1fr)_8rem_minmax(16rem,1.4fr)_2.5rem] md:items-center md:gap-4"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{s.email}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {meta?.blurb ?? s.role}
                    </div>
                  </div>

                  <div>
                    <span
                      className={cn(
                        "inline-block rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider",
                        s.role === "admin"
                          ? "bg-hard/15 text-hard"
                          : s.role === "ceo"
                            ? "bg-primary/15 text-primary"
                            : s.role === "placement_officer"
                              ? "bg-medium/15 text-medium"
                              : "bg-accent text-accent-foreground",
                      )}
                    >
                      {meta?.label ?? s.role}
                    </span>
                  </div>

                  {/* The signature of this page: access rendered in the shape it
                      actually takes for that role, rather than one control for
                      all four. */}
                  <div className="min-w-0">
                    {meta?.scope === "none" && (
                      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-hard">
                        <ShieldCheck className="size-3.5" /> Every college and cohort
                      </span>
                    )}
                    {meta?.scope === "colleges" && (
                      <CollegeAccess
                        colleges={colleges}
                        assignedIds={s.college_ids}
                        role={s.role as StaffRole}
                        onToggle={(collegeId, assigned) =>
                          collegeM.mutate({ userId: s.user_id, collegeId, assigned })
                        }
                      />
                    )}
                    {meta?.scope === "classrooms" && (
                      <ClassroomAccess
                        classrooms={classrooms}
                        assignedIds={s.classroom_ids}
                        onAssign={(classroomId) =>
                          assignM.mutate({ userId: s.user_id, classroomId })
                        }
                        onUnassign={(classroomId) =>
                          unassignM.mutate({ userId: s.user_id, classroomId })
                        }
                      />
                    )}
                  </div>

                  <div className="md:justify-self-end">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={`Actions for ${s.email}`}
                        >
                          <MoreVertical className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                          {s.email}
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() =>
                            setConfirm({ kind: "reset", userId: s.user_id, email: s.email })
                          }
                        >
                          <Key className="size-4" /> Reset password
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() =>
                            setConfirm({ kind: "delete", userId: s.user_id, email: s.email })
                          }
                        >
                          <Trash2 className="size-4" /> Delete account
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/*
        Maintenance, kept apart from the people. The refresh lock is not a staff
        record and shared a card with them only because both happened to be
        admin-only.
      */}
      <div className="mt-10 rounded-lg border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Maintenance
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              A refresh that crashed can leave its lock held, which blocks every later run. Release
              it only when nothing is actually refreshing.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => forceReleaseM.mutate()}
            disabled={forceReleaseM.isPending}
          >
            <Unlock className="mr-1 size-4" />
            {forceReleaseM.isPending ? "Releasing…" : "Release refresh lock"}
          </Button>
        </div>
      </div>

      <CreateStaffDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        classrooms={classrooms}
        classroomsLoading={classroomsLoading}
        colleges={colleges}
        onCreated={settleStaff}
      />

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "delete" ? "Delete this account?" : "Reset this password?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "delete" ? (
                <>
                  {confirm.email} loses access immediately, along with their role and every
                  assignment. This cannot be undone.
                </>
              ) : (
                <>
                  Generates a new temporary password for {confirm?.email} and invalidates their
                  current one. It is shown to you once — copy it and share it securely.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirm) return;
                if (confirm.kind === "delete") deactivateM.mutate(confirm.userId);
                else resetPwM.mutate(confirm.userId);
              }}
            >
              {confirm?.kind === "delete" ? "Delete account" : "Reset password"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RoleChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] font-semibold transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-surface text-muted-foreground hover:border-primary/50 hover:text-foreground",
      )}
    >
      {label}
      <span className={cn("tabular-nums", active ? "opacity-80" : "opacity-60")}>{count}</span>
    </button>
  );
}

/**
 * College oversight for the two roles scoped by it.
 *
 * The empty state is the important part and differs by role: an unassigned CEO
 * can see NOTHING, an unassigned placement officer still has platform-wide
 * reach. Same blank list, opposite meanings, so they must not look alike.
 */
function CollegeAccess({
  colleges,
  assignedIds,
  role,
  onToggle,
}: {
  colleges: { id: string; name: string }[];
  assignedIds: string[];
  role: StaffRole;
  onToggle: (collegeId: string, assigned: boolean) => void;
}) {
  const assigned = colleges.filter((c) => assignedIds.includes(c.id));
  const available = colleges.filter((c) => !assignedIds.includes(c.id));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {assigned.length === 0 &&
        (role === "ceo" ? (
          <span
            className="font-mono text-[10px] uppercase tracking-wider text-hard"
            title="A CEO with no college assigned sees nothing at all."
          >
            No college — sees nothing
          </span>
        ) : (
          <span
            className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
            title="Platform-wide access. Assigning a college restricts them to it."
          >
            All colleges
          </span>
        ))}

      {assigned.map((c) => (
        <button
          key={c.id}
          onClick={() => onToggle(c.id, false)}
          className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/20"
          title={`Remove ${c.name}`}
        >
          <Building2 className="size-3" /> {c.name}
        </button>
      ))}

      {available.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="inline-flex items-center gap-1 rounded border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground"
              aria-label="Assign a college"
            >
              <Plus className="size-3" /> College
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {available.map((c) => (
              <DropdownMenuItem key={c.id} onSelect={() => onToggle(c.id, true)}>
                {c.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/**
 * Cohort access for faculty.
 *
 * Only what they HAVE is shown as chips; adding one is a menu of what they do
 * not. The previous version rendered every classroom in the database on every
 * faculty row, so the row grew with the institution and finding the assigned
 * ones meant scanning for highlights.
 */
function ClassroomAccess({
  classrooms,
  assignedIds,
  onAssign,
  onUnassign,
}: {
  classrooms: PickerClassroom[];
  assignedIds: string[];
  onAssign: (classroomId: string) => void;
  onUnassign: (classroomId: string) => void;
}) {
  const assigned = classrooms.filter((c) => assignedIds.includes(c.id));
  const available = classrooms.filter((c) => !assignedIds.includes(c.id));
  const multiCollege = new Set(classrooms.map((c) => c.college_id)).size > 1;

  const byCollege = new Map<string, PickerClassroom[]>();
  for (const c of available) {
    const key = c.college_name ?? "No college";
    byCollege.set(key, [...(byCollege.get(key) ?? []), c]);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {assigned.length === 0 && (
        <span className="font-mono text-[10px] uppercase tracking-wider text-medium">
          No cohorts — sees nothing
        </span>
      )}

      {assigned.map((c) => (
        <button
          key={c.id}
          onClick={() => onUnassign(c.id)}
          className="inline-flex items-center gap-1 rounded bg-accent px-2 py-1 text-xs font-medium text-accent-foreground hover:bg-accent/70"
          title={`Remove ${c.name}${c.college_name ? ` (${c.college_name})` : ""}`}
        >
          <Layers className="size-3" />
          {c.name}
          {multiCollege && c.college_name && <span className="opacity-60">· {c.college_name}</span>}
        </button>
      ))}

      {available.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="inline-flex items-center gap-1 rounded border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground"
              aria-label="Assign a cohort"
            >
              <Plus className="size-3" /> Cohort
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 w-60 overflow-y-auto">
            {[...byCollege.entries()]
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([college, rooms]) => (
                <div key={college}>
                  {multiCollege && (
                    <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      {college}
                    </DropdownMenuLabel>
                  )}
                  {rooms
                    .slice()
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((c) => (
                      <DropdownMenuItem key={c.id} onSelect={() => onAssign(c.id)}>
                        {c.name}
                      </DropdownMenuItem>
                    ))}
                </div>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/**
 * Add a staff account.
 *
 * A dialog rather than a permanent form. Creating staff is occasional; the form
 * held the top third of the page at all times, above the list people actually
 * came to read.
 *
 * The scope controls swap with the role, because the roles are scoped by
 * different things — showing a classroom picker to a CEO would imply a grant
 * that does not exist.
 */
function CreateStaffDialog({
  open,
  onOpenChange,
  classrooms,
  classroomsLoading,
  colleges,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classrooms: PickerClassroom[];
  classroomsLoading: boolean;
  colleges: { id: string; name: string }[];
  onCreated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<StaffRole>("faculty");
  const [selectedColleges, setSelectedColleges] = useState<string[]>([]);
  const [selectedClassrooms, setSelectedClassrooms] = useState<string[]>([]);

  const create = useServerFn(createStaffUser);
  const createM = useMutation({
    mutationFn: () =>
      create({
        data: {
          email,
          name,
          role,
          classroom_ids: role === "faculty" ? selectedClassrooms : undefined,
          college_ids:
            role === "ceo" || role === "placement_officer" ? selectedColleges : undefined,
        },
      }),
    onSuccess: (res) => {
      toast.success(`Temporary password: ${res.tempPassword}`, {
        description: "Shown once. Copy it now and share it securely.",
        duration: Infinity,
        closeButton: true,
      });
      onCreated();
      setEmail("");
      setName("");
      setRole("faculty");
      setSelectedColleges([]);
      setSelectedClassrooms([]);
      onOpenChange(false);
    },
    onError: (e) => toast.error(String(e)),
  });

  const meta = ROLE_META[role];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add staff</DialogTitle>
          <DialogDescription>
            They sign in with a temporary password, shown once when the account is created.
          </DialogDescription>
        </DialogHeader>

        <form
          id="create-staff"
          onSubmit={(e) => {
            e.preventDefault();
            createM.mutate();
          }}
          className="space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="staff-email">Email</Label>
              <Input
                id="staff-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@college.edu"
                className="mt-1"
                required
              />
            </div>
            <div>
              <Label htmlFor="staff-name">Name</Label>
              <Input
                id="staff-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Dr Jane Smith"
                className="mt-1"
                required
              />
            </div>
          </div>

          <div>
            <Label htmlFor="staff-role">Role</Label>
            <Select value={role} onValueChange={(v: StaffRole) => setRole(v)}>
              <SelectTrigger id="staff-role" aria-label="Staff role" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_ORDER.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_META[r].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1.5 text-[11px] text-muted-foreground">{meta.blurb}</p>
          </div>

          {meta.scope === "colleges" && (
            <div>
              <Label>{role === "ceo" ? "Colleges" : "Colleges (optional)"}</Label>
              <p className="mb-1.5 mt-1 text-[11px] text-muted-foreground">
                {role === "ceo"
                  ? "Without one they see nothing."
                  : "Leave empty for platform-wide access."}
              </p>
              <div className="rounded-md border border-border bg-background p-1">
                {colleges.length === 0 && (
                  <p className="p-2 text-xs text-muted-foreground">No colleges yet.</p>
                )}
                {colleges.map((c) => (
                  <label
                    key={c.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
                  >
                    <Checkbox
                      checked={selectedColleges.includes(c.id)}
                      onCheckedChange={() =>
                        setSelectedColleges((prev) =>
                          prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id],
                        )
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {meta.scope === "classrooms" && (
            <div>
              <Label>Cohorts</Label>
              <div className="mt-1">
                <ClassroomPicker
                  classrooms={classrooms}
                  selected={selectedClassrooms}
                  loading={classroomsLoading}
                  onToggle={(id) =>
                    setSelectedClassrooms((prev) =>
                      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                    )
                  }
                  onToggleMany={(ids, select) =>
                    setSelectedClassrooms((prev) =>
                      select
                        ? [...new Set([...prev, ...ids])]
                        : prev.filter((x) => !ids.includes(x)),
                    )
                  }
                />
              </div>
            </div>
          )}

          {meta.scope === "none" && (
            <p className="rounded-md bg-hard/10 px-3 py-2 text-[11px] text-muted-foreground">
              An admin can see and change every college, cohort and student, and can create further
              admins. There is no way to scope one.
            </p>
          )}
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-staff"
            disabled={createM.isPending || !email.trim() || !name.trim()}
          >
            {createM.isPending ? "Creating…" : "Create account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

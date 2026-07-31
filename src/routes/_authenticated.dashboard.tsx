import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Users, Trash2, ArrowRight, Sparkles, BarChart3, Shield, UserCog } from "lucide-react";

import { listClassrooms, deleteClassroom } from "@/lib/classrooms.functions";
import { seedMockClassroom } from "@/lib/mock.functions";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
  AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { SectionTitle } from "@/components/stat-card";
import { BulkUploader } from "@/components/bulk-uploader";
import { useRole } from "@/hooks/use-role";
import { AnimatedLoader } from "@/components/animated-loader";

const classroomsQO = queryOptions({
  queryKey: ["classrooms"],
  queryFn: () => listClassrooms(),
});

/**
 * This is where you land after signing in, and it was the one data-backed page
 * with no pendingComponent — it paired a loader with useSuspenseQuery and rendered
 * nothing at all while classrooms loaded.
 */
function PendingDashboard() {
  return <AnimatedLoader text="Loading dashboard…" />;
}

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Almanac" },
      { name: "description", content: "Manage classrooms and track LeetCode progress." },
    ],
  }),
  loader: ({ context }) => {
    if (typeof window !== "undefined") {
      return context.queryClient.ensureQueryData(classroomsQO);
    }
  },
  component: DashboardPage,
  pendingComponent: PendingDashboard,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-destructive">{error.message}</div>
  ),
});

function DashboardPage() {
  const { role, isAdmin, isPlacementOfficer: isPO, isFaculty } = useRole();
  const { data: classroomData } = useSuspenseQuery(classroomsQO);
  const classrooms = classroomData.classrooms;
  const router = useRouter();

  /*
    Faculty covering more than one cohort get the Overview as their home. For
    them this page is a list of two-to-N links they already have in the sidebar,
    while Overview answers the question they actually open the app with: which of
    my cohorts needs attention today. Single-classroom faculty stay here, where
    the dashboard is still the shortest path to their one classroom.

    `replace` keeps Back working — without it the redirect and the dashboard
    fight over the same history entry.
  */
  const redirectToOverview = isFaculty && classrooms.length > 1;
  useEffect(() => {
    if (redirectToOverview) router.navigate({ to: "/overview", replace: true });
  }, [redirectToOverview, router]);
  const qc = useQueryClient();
  const del = useServerFn(deleteClassroom);
  const mock = useServerFn(seedMockClassroom);

  const mutation = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["classrooms"] });
      toast.success("Classroom deleted");
    },
    onError: (e) => toast.error(String(e)),
  });

  const mockM = useMutation({
    mutationFn: () => mock(),
    onSuccess: (r) => {
      toast.success(r.created ? "Demo classroom seeded" : "Demo classroom already exists");
      router.invalidate();
      router.navigate({ to: "/classrooms/$id", params: { id: r.id } });
    },
    onError: (e) => toast.error(String(e)),
  });

  // Placed after every hook above — an early return before them would make the
  // hook order conditional.
  if (redirectToOverview) return <AnimatedLoader text="Opening overview…" />;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-mono text-xs uppercase tracking-[0.25em] text-primary">
            Almanac / {role === "admin" ? "Admin" : role === "placement_officer" ? "Overview" : "Dashboard"}
          </h1>
          <h2 className="mt-2 text-3xl font-bold tracking-tight">
            {isAdmin ? "Command Center" : isPO ? "College Overview" : "My Classrooms"}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {classrooms.length} cohort{classrooms.length === 1 ? "" : "s"} ·{" "}
            {classroomData.totalStudents} students.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isPO && (
            <Button asChild variant="outline">
              <Link to="/overview">
                <BarChart3 className="mr-1 size-4" /> Cross-Classroom Analytics
              </Link>
            </Button>
          )}
          {isAdmin && (
            <>
              <Button asChild variant="outline">
                <Link to="/staff">
                  <UserCog className="mr-1 size-4" /> Manage Staff
                </Link>
              </Button>
              <Button
                variant="outline"
                onClick={() => mockM.mutate()}
                disabled={mockM.isPending}
              >
                <Sparkles className="mr-1 size-4" />
                {mockM.isPending ? "Seeding…" : "Try Demo Data"}
              </Button>
              <Button asChild>
                <Link to="/classrooms/new">
                  <Plus className="mr-1 size-4" /> New Classroom
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>

      {(isAdmin) && (
        <div className="mb-10">
          <BulkUploader />
        </div>
      )}

      <SectionTitle>Active Cohorts</SectionTitle>
      {classrooms.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-16 text-center">
          <Users className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? "No classrooms yet. Upload a file above, or spin up demo data to explore the UI."
              : "No classrooms assigned yet. Contact your admin."}
          </p>
          {isAdmin && (
            <div className="mt-6 flex justify-center gap-2">
              <Button onClick={() => mockM.mutate()} disabled={mockM.isPending}>
                <Sparkles className="mr-1 size-4" /> Seed Demo Classroom
              </Button>
              <Button asChild variant="outline">
                <Link to="/classrooms/new">
                  <Plus className="mr-1 size-4" /> Create Manually
                </Link>
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {classrooms.map((c, i) => (
            <Link
              key={c.id}
              to="/classrooms/$id"
              params={{ id: c.id }}
              // Cohort cards used to hard-appear the instant the skeleton cleared.
              // A short, capped stagger gives the grid a direction without making
              // the page feel slower.
              style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
              className="group relative block animate-in fade-in slide-in-from-bottom-2 fill-mode-backwards rounded-lg border border-border bg-surface p-6 transition-colors hover:border-primary/50"
            >
              <div className="mb-6 flex items-start justify-between">
                <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-primary">
                  [ COHORT_{String(i + 1).padStart(2, "0")} ]
                </span>
                <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-primary">
                  LIVE
                </span>
              </div>
              <h3 className="mb-1 text-lg font-bold">{c.name}</h3>
              <p className="mb-6 line-clamp-2 min-h-[2.5rem] text-sm text-muted-foreground">
                {c.description || <span className="italic">No description</span>}
              </p>
              <div className="mb-6 flex gap-6 font-mono text-[10px]">
                <div>
                  <span className="block text-muted-foreground">STUDENTS</span>
                  <span className="text-base font-bold">{c.student_count}</span>
                </div>
                <div>
                  <span className="block text-muted-foreground">CREATED</span>
                  <span className="text-base font-bold">
                    {new Date(c.created_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1 text-sm font-semibold text-primary group-hover:underline">
                  Open <ArrowRight className="size-4" />
                </span>
                {isAdmin && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                        aria-label="Delete classroom"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete classroom</AlertDialogTitle>
                        <AlertDialogDescription>
                          Delete "{c.name}" and all its students? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => mutation.mutate(c.id)}>
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

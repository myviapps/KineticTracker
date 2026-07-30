import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { Users, ArrowRight } from "lucide-react";

import { listClassrooms } from "@/lib/classrooms.functions";
import { useRole } from "@/hooks/use-role";
import { AnimatedLoader } from "@/components/animated-loader";

const classroomsQO = queryOptions({
  queryKey: ["classrooms"],
  queryFn: () => listClassrooms(),
});

function PendingClassrooms() {
  return <AnimatedLoader text="Loading classrooms…" />;
}

export const Route = createFileRoute("/_authenticated/classrooms/")({
  head: () => ({ meta: [{ title: "Classrooms — Almanac" }] }),
  // The window guard is not cosmetic. `attachSupabaseAuth` is a CLIENT middleware,
  // so a loader that runs during SSR calls listClassrooms with no Authorization
  // header and `requireSupabaseAuth` rejects it — this route threw
  // "Unauthorized: No authorization header provided" on any hard navigation.
  // Every other authenticated route already guarded this; this one didn't.
  loader: ({ context }) => {
    if (typeof window !== "undefined") {
      return context.queryClient.ensureQueryData(classroomsQO);
    }
  },
  component: ClassroomsListPage,
  pendingComponent: PendingClassrooms,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-destructive">{error.message}</div>
  ),
});

function ClassroomsListPage() {
  const { data: classrooms } = useSuspenseQuery(classroomsQO);
  const { canViewAllClassrooms } = useRole();

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-8">
        <h1 className="font-mono text-xs uppercase tracking-[0.25em] text-primary">
          Almanac / Classrooms
        </h1>
        {/* listClassrooms is scoped by role now, so "All Classrooms" would be a lie
            for a faculty member seeing only their assignments. */}
        <h2 className="mt-2 text-3xl font-bold tracking-tight">
          {canViewAllClassrooms ? "All Classrooms" : "My Classrooms"}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {classrooms.length} cohort{classrooms.length === 1 ? "" : "s"}.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {classrooms.length === 0 && (
          <div className="col-span-full rounded-lg border border-dashed border-border p-16 text-center">
            <Users className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {canViewAllClassrooms
                ? "No classrooms yet."
                : "No classrooms assigned to you yet. Contact your admin."}
            </p>
          </div>
        )}
        {classrooms.map((c, i) => (
          <Link
            key={c.id}
            to="/classrooms/$id"
            params={{ id: c.id }}
            style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
            className="group animate-in fade-in slide-in-from-bottom-2 fill-mode-backwards rounded-lg border border-border bg-surface p-6 transition-colors hover:border-primary/50"
          >
            <h3 className="text-lg font-bold">{c.name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {c.description || "No description"}
            </p>
            <div className="mt-4 flex items-center justify-between font-mono text-xs">
              <span className="text-muted-foreground">
                {c.student_count} student{c.student_count === 1 ? "" : "s"}
              </span>
              <span className="inline-flex items-center gap-1 text-primary group-hover:underline">
                Open <ArrowRight className="size-3" />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

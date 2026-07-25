import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { Users, ArrowRight } from "lucide-react";

import { listClassrooms } from "@/lib/classrooms.functions";

const classroomsQO = queryOptions({
  queryKey: ["classrooms"],
  queryFn: () => listClassrooms(),
});

export const Route = createFileRoute("/_authenticated/classrooms/")({
  head: () => ({ meta: [{ title: "Classrooms — Kinetic" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(classroomsQO),
  component: ClassroomsListPage,
});

function ClassroomsListPage() {
  const { data: classrooms } = useSuspenseQuery(classroomsQO);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-8">
        <h1 className="font-mono text-xs uppercase tracking-[0.25em] text-primary">
          Kinetic / Classrooms
        </h1>
        <h2 className="mt-2 text-3xl font-bold tracking-tight">All Classrooms</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {classrooms.length} cohort{classrooms.length === 1 ? "" : "s"}.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {classrooms.length === 0 && (
          <div className="col-span-full rounded-lg border border-dashed border-border p-16 text-center">
            <Users className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No classrooms available.</p>
          </div>
        )}
        {classrooms.map((c) => (
          <Link
            key={c.id}
            to="/classrooms/$id"
            params={{ id: c.id }}
            className="group rounded-lg border border-border bg-surface p-6 transition-colors hover:border-primary/50"
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

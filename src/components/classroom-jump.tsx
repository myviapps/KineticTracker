import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Layers } from "lucide-react";

import { listClassrooms } from "@/lib/classrooms.functions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * Jump straight to a cohort from the header.
 *
 * Switching classroom is the app's most frequent action, and the two existing
 * routes to it both cost a page: the sidebar is routinely collapsed to an icon
 * rail, and /classrooms is a full stop on the way to somewhere else. This lands
 * you in the cohort in one click.
 *
 * Shares the ["classrooms"] cache with the sidebar and the classrooms page, so
 * opening it is normally free, and the server has already scoped the list to
 * what the caller may see — there is no role gate to apply here.
 */
export function ClassroomJump({ className }: { className?: string }) {
  const { data, isPending } = useQuery({
    queryKey: ["classrooms"],
    queryFn: () => listClassrooms(),
    staleTime: 60_000,
  });
  const classrooms = data?.classrooms ?? [];

  // "Current" comes from the live path rather than the remembered id: while you
  // are standing in a cohort, that is the honest answer.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const currentId = pathname.startsWith("/classrooms/") ? pathname.split("/")[2] : null;
  const current = classrooms.find((c) => c.id === currentId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn("shrink-0 px-2", className)}
          title="Jump to a classroom"
        >
          <Layers className="size-4" />
          {/* The cohort you are in, when there is room — the header doubles as a
              "where am I" indicator rather than only a menu. */}
          <span className="ml-1 hidden max-w-[140px] truncate lg:inline">
            {current ? current.name : "Classrooms"}
          </span>
          <ChevronDown className="ml-0.5 hidden size-3 opacity-60 lg:inline" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="max-h-[70vh] w-64 overflow-y-auto">
        <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Jump to classroom
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {isPending && <div className="px-2 py-3 text-xs text-muted-foreground">Loading…</div>}

        {!isPending && classrooms.length === 0 && (
          <div className="px-2 py-3 text-xs text-muted-foreground">No classrooms assigned yet.</div>
        )}

        {classrooms.map((c) => {
          const active = c.id === currentId;
          return (
            <DropdownMenuItem key={c.id} asChild>
              <Link
                to="/classrooms/$id"
                params={{ id: c.id }}
                className={cn("flex items-center gap-2", active && "text-primary")}
              >
                <span className={active ? "text-primary" : "text-muted-foreground/60"}>
                  {active ? "●" : "○"}
                </span>
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {c.student_count}
                </span>
              </Link>
            </DropdownMenuItem>
          );
        })}

        {classrooms.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/classrooms" className="text-xs text-muted-foreground">
                View all classrooms…
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

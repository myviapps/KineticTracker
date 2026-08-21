import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  RefreshCw,
  Search,
  Building2,
  Users,
  CheckSquare,
  Square,
  X,
} from "lucide-react";

import { enqueueRefresh } from "@/lib/refresh-jobs.functions";
import { REFRESH_JOB_KEY, invalidateScrapedData } from "@/hooks/use-refresh-job";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export interface CohortOption {
  id: string;
  name: string;
  college_id?: string | null;
}

export interface CollegeOption {
  id: string;
  name: string;
}

export interface StudentOption {
  id: string;
  classroom_ids: string[];
}

export function RefreshCohortsDialog({
  open,
  onOpenChange,
  classrooms,
  colleges,
  students,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classrooms: CohortOption[];
  colleges: CollegeOption[];
  students: StudentOption[];
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const qc = useQueryClient();
  const enqueue = useServerFn(enqueueRefresh);

  // Student count map per classroom
  const studentCountByClassroom = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of classrooms) counts.set(c.id, 0);
    for (const s of students) {
      for (const cid of s.classroom_ids) {
        counts.set(cid, (counts.get(cid) ?? 0) + 1);
      }
    }
    return counts;
  }, [classrooms, students]);

  // College name lookup
  const collegeNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const col of colleges) map.set(col.id, col.name);
    return map;
  }, [colleges]);

  // Group cohorts by college
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<
      string,
      { collegeId: string | null; collegeName: string; rooms: CohortOption[] }
    >();

    for (const c of classrooms) {
      const colName = c.college_id ? (collegeNameById.get(c.college_id) ?? "Unknown College") : "Unassigned";
      // Filter by search term
      if (
        q &&
        !c.name.toLowerCase().includes(q) &&
        !colName.toLowerCase().includes(q)
      ) {
        continue;
      }

      const key = c.college_id ?? "none";
      const entry = map.get(key) ?? {
        collegeId: c.college_id ?? null,
        collegeName: colName,
        rooms: [],
      };
      entry.rooms.push(c);
      map.set(key, entry);
    }

    return [...map.values()].sort((a, b) => {
      if (a.collegeId === null) return 1;
      if (b.collegeId === null) return -1;
      return a.collegeName.localeCompare(b.collegeName);
    });
  }, [classrooms, collegeNameById, search]);

  const distinctCollegesCount = useMemo(() => {
    return new Set(classrooms.map((c) => c.college_id).filter(Boolean)).size;
  }, [classrooms]);

  const hasMultipleColleges = distinctCollegesCount > 1;

  // Toggle single cohort
  const toggleCohort = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Toggle all in a college group
  const toggleCollegeGroup = (rooms: CohortOption[]) => {
    const allSelected = rooms.every((r) => selectedIds.has(r.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const r of rooms) next.delete(r.id);
      } else {
        for (const r of rooms) next.add(r.id);
      }
      return next;
    });
  };

  // Select all visible
  const selectAll = () => {
    const all = new Set<string>();
    for (const g of groups) {
      for (const r of g.rooms) all.add(r.id);
    }
    setSelectedIds(all);
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  // Count unique students across selected classrooms
  const selectedStudentCount = useMemo(() => {
    if (selectedIds.size === 0) return 0;
    const studentSet = new Set<string>();
    for (const s of students) {
      if (s.classroom_ids.some((cid) => selectedIds.has(cid))) {
        studentSet.add(s.id);
      }
    }
    return studentSet.size;
  }, [selectedIds, students]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (selectedIds.size === 0) return;
      return enqueue({
        data: {
          scope: "classroom",
          classroomIds: Array.from(selectedIds),
        },
      });
    },
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: REFRESH_JOB_KEY });
      invalidateScrapedData(qc);
      const n = res?.queued?.length ?? 0;
      const busy = res?.skipped?.filter((s) => s.reason === "already running") ?? [];
      toast.success(
        `Refresh queued for ${selectedIds.size} cohort${selectedIds.size === 1 ? "" : "s"} across ${n} platform${n === 1 ? "" : "s"}` +
          (busy.length ? ` · ${busy.map((b) => b.platformId).join(", ")} already running` : ""),
      );
      onOpenChange(false);
      setSelectedIds(new Set());
    },
    onError: (e: unknown) => toast.error(String(e instanceof Error ? e.message : e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="size-5 text-primary" />
            Refresh Selected Cohorts
          </DialogTitle>
          <DialogDescription>
            Select which cohorts to refresh. All student profiles across active platforms will be synced.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          {/* Search bar & quick select */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={hasMultipleColleges ? "Search cohorts or colleges…" : "Search cohorts…"}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-8 text-sm"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <div className="flex gap-1.5 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={selectAll}
                className="h-9 text-xs"
              >
                <CheckSquare className="mr-1 size-3.5" />
                Select All
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearSelection}
                disabled={selectedIds.size === 0}
                className="h-9 text-xs text-muted-foreground"
              >
                Clear
              </Button>
            </div>
          </div>

          {/* Cohort list */}
          <div className="max-h-[340px] overflow-y-auto space-y-4 rounded-md border border-border p-3">
            {groups.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No cohorts found matching "{search}".
              </div>
            ) : (
              groups.map((group) => {
                const allGroupSelected = group.rooms.every((r) => selectedIds.has(r.id));
                const someGroupSelected =
                  !allGroupSelected && group.rooms.some((r) => selectedIds.has(r.id));

                return (
                  <div key={group.collegeName} className="space-y-1.5">
                    {hasMultipleColleges && (
                      <div className="flex items-center justify-between pb-1 border-b border-border/60">
                        <div className="flex items-center gap-1.5">
                          <Building2 className="size-3.5 text-primary" />
                          <span className="font-mono text-xs font-semibold uppercase tracking-wider text-foreground">
                            {group.collegeName}
                          </span>
                          <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">
                            {group.rooms.length}
                          </Badge>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleCollegeGroup(group.rooms)}
                          className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          {allGroupSelected ? "Deselect group" : "Select group"}
                        </Button>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-0.5">
                      {group.rooms.map((room) => {
                        const isChecked = selectedIds.has(room.id);
                        const count = studentCountByClassroom.get(room.id) ?? 0;

                        return (
                          <label
                            key={room.id}
                            className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg border p-2.5 text-sm transition-colors ${
                              isChecked
                                ? "border-primary bg-primary/5 text-foreground shadow-xs"
                                : "border-border bg-card/50 hover:bg-muted/50 text-foreground"
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={() => toggleCohort(room.id)}
                              />
                              <span className="truncate font-medium">{room.name}</span>
                            </div>
                            <Badge
                              variant="outline"
                              className="shrink-0 text-[11px] font-mono text-muted-foreground"
                            >
                              <Users className="mr-1 size-3" />
                              {count}
                            </Badge>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Selection summary */}
          <div className="flex items-center justify-between text-xs text-muted-foreground px-0.5">
            <div>
              <span className="font-semibold text-foreground">{selectedIds.size}</span> of{" "}
              {classrooms.length} cohort{classrooms.length === 1 ? "" : "s"} selected
            </div>
            {selectedIds.size > 0 && (
              <div className="font-medium text-foreground">
                Total {selectedStudentCount} unique student{selectedStudentCount === 1 ? "" : "s"}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2 border-t border-border">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={selectedIds.size === 0 || mutation.isPending}
          >
            <RefreshCw
              className={`mr-1.5 size-4 ${mutation.isPending ? "animate-spin" : ""}`}
            />
            {mutation.isPending
              ? "Queueing Refresh…"
              : selectedIds.size > 0
                ? `Refresh ${selectedIds.size} Cohort${selectedIds.size === 1 ? "" : "s"}`
                : "Refresh Selected"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

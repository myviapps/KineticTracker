import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export type PickerClassroom = {
  id: string;
  name: string;
  college_id: string | null;
  college_name: string | null;
  student_count?: number;
};

/**
 * Choose classrooms, grouped by college.
 *
 * Replaces a 160px scroll box of undifferentiated checkboxes. That was workable
 * at six cohorts in one college and stopped being usable the moment there were
 * several colleges: nothing on screen said which college a cohort belonged to,
 * there was no search, and selecting a whole college meant ticking every row by
 * hand. It also could not be fixed in the UI alone — listClassrooms did not
 * return college_id until now.
 *
 * Ordering puts the already-selected first within each college, because the
 * question when editing an existing member is "what do they have?", not "what
 * exists?".
 */
export function ClassroomPicker({
  classrooms,
  selected,
  onToggle,
  onToggleMany,
  loading,
  emptyLabel = "No classrooms yet.",
}: {
  classrooms: PickerClassroom[];
  selected: string[];
  onToggle: (id: string) => void;
  /** Select or clear a whole college at once. */
  onToggleMany: (ids: string[], select: boolean) => void;
  loading?: boolean;
  emptyLabel?: string;
}) {
  const [q, setQ] = useState("");

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const match = needle
      ? classrooms.filter(
          (c) =>
            c.name.toLowerCase().includes(needle) ||
            (c.college_name ?? "").toLowerCase().includes(needle),
        )
      : classrooms;

    const by = new Map<string, { name: string; rooms: PickerClassroom[] }>();
    for (const c of match) {
      const key = c.college_id ?? "__none";
      const g = by.get(key) ?? { name: c.college_name ?? "No college", rooms: [] };
      g.rooms.push(c);
      by.set(key, g);
    }
    for (const g of by.values()) {
      g.rooms.sort((a, b) => {
        const sa = selected.includes(a.id) ? 0 : 1;
        const sb = selected.includes(b.id) ? 0 : 1;
        return sa !== sb ? sa - sb : a.name.localeCompare(b.name);
      });
    }
    return [...by.entries()]
      .map(([id, g]) => ({ id, ...g }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [classrooms, q, selected]);

  const total = classrooms.length;
  const chosen = selected.length;

  return (
    <div className="rounded-md border border-border bg-background">
      <div className="flex items-center gap-2 border-b border-border p-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter cohorts or colleges…"
            aria-label="Filter classrooms"
            className="h-8 pl-7 text-sm"
          />
        </div>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {chosen} / {total}
        </span>
      </div>

      <div className="max-h-72 overflow-y-auto p-1">
        {loading && <p className="p-3 text-xs text-muted-foreground">Loading cohorts…</p>}
        {!loading && total === 0 && (
          <p className="p-3 text-xs text-muted-foreground">{emptyLabel}</p>
        )}
        {!loading && total > 0 && groups.length === 0 && (
          <p className="p-3 text-xs text-muted-foreground">Nothing matches &ldquo;{q}&rdquo;.</p>
        )}

        {groups.map((g) => {
          const ids = g.rooms.map((r) => r.id);
          const allOn = ids.every((id) => selected.includes(id));
          return (
            <div key={g.id} className="mb-1 last:mb-0">
              <div className="flex items-center justify-between gap-2 px-2 py-1">
                <span className="truncate font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {g.name}
                </span>
                <button
                  type="button"
                  onClick={() => onToggleMany(ids, !allOn)}
                  className="shrink-0 text-[10px] font-medium text-primary hover:underline"
                >
                  {allOn ? "Clear" : "Select all"}
                </button>
              </div>
              {g.rooms.map((c) => (
                <label
                  key={c.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent",
                    selected.includes(c.id) && "text-foreground",
                  )}
                >
                  <Checkbox
                    checked={selected.includes(c.id)}
                    onCheckedChange={() => onToggle(c.id)}
                  />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  {c.student_count !== undefined && (
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {c.student_count}
                    </span>
                  )}
                </label>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

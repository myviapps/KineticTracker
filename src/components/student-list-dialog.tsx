import { Link } from "@tanstack/react-router";
import { Download } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { StudentRow } from "@/lib/buckets";

export type ListedStudent = StudentRow & { classroom?: string | null };

/**
 * The roster behind a headline number.
 *
 * The bucket cards reported "14 At Risk" with no way to find out which 14 —
 * clicking one now opens the actual list, with the classroom each student
 * belongs to so a cross-cohort count is actionable.
 */
export function StudentListDialog({
  open,
  onOpenChange,
  title,
  students,
  showClassroom = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  students: ListedStudent[];
  showClassroom?: boolean;
}) {
  function exportCsv() {
    const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = [
      "Name", "Roll", ...(showClassroom ? ["Classroom"] : []),
      "LeetCode ID", "Total", "Easy", "Medium", "Hard", "Today", "This week", "Last 30d", "Streak",
    ];
    const lines = students.map((s) =>
      [
        s.name, s.roll, ...(showClassroom ? [s.classroom ?? ""] : []),
        s.leetcode_id, s.total, s.easy, s.medium, s.hard, s.today, s.week, s.last30, s.streak,
      ].map(escape).join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {students.length} student{students.length === 1 ? "" : "s"}. Select a name to open
            their full profile.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 border-b border-border bg-background font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Student</th>
                {showClassroom && <th className="px-3 py-2">Classroom</th>}
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right text-easy">E</th>
                <th className="px-3 py-2 text-right text-medium">M</th>
                <th className="px-3 py-2 text-right text-hard">H</th>
                <th className="px-3 py-2 text-right">Today</th>
                <th className="px-3 py-2 text-right">7d</th>
                <th className="px-3 py-2 text-right">30d</th>
                <th className="px-3 py-2 text-right">Streak</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-mono tabular-nums">
              {students.length === 0 && (
                <tr>
                  <td colSpan={showClassroom ? 10 : 9} className="px-3 py-12 text-center text-muted-foreground">
                    No students in this group.
                  </td>
                </tr>
              )}
              {students.map((s) => (
                <tr key={s.id} className="hover:bg-primary/5">
                  <td className="px-3 py-2">
                    <Link
                      to="/students/$roll"
                      params={{ roll: s.roll }}
                      className="font-sans text-xs font-semibold hover:text-primary hover:underline"
                    >
                      {s.name}
                    </Link>
                    <div className="text-[10px] text-muted-foreground">{s.roll}</div>
                  </td>
                  {showClassroom && (
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {s.classroom ?? "—"}
                    </td>
                  )}
                  <td className="px-3 py-2 text-right text-xs font-bold">{s.total}</td>
                  <td className="px-3 py-2 text-right text-xs text-easy">{s.easy}</td>
                  <td className="px-3 py-2 text-right text-xs text-medium">{s.medium}</td>
                  <td className="px-3 py-2 text-right text-xs text-hard">{s.hard}</td>
                  <td className="px-3 py-2 text-right text-xs">
                    {s.today > 0 ? (
                      <span className="text-primary">{s.today}</span>
                    ) : (
                      <span className="text-muted-foreground/50">0</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-muted-foreground">{s.week}</td>
                  <td className="px-3 py-2 text-right text-xs text-muted-foreground">{s.last30}</td>
                  <td className="px-3 py-2 text-right text-xs">{s.streak}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={students.length === 0}>
            <Download className="mr-1 size-3.5" />
            Export CSV
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

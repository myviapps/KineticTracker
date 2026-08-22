import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle } from "lucide-react";

import { bulkImportWithClassrooms } from "@/lib/bulk-import.functions";
import {
  parseFile,
  parseCsvText,
  templateCsv,
  PLATFORM_COLUMNS,
  type ParsedRow,
} from "@/lib/file-parser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isFetchable, platformStatus, statusNote } from "@/lib/platform-capabilities";

export function BulkUploader({ onDone }: { onDone?: (n: number) => void }) {
  const qc = useQueryClient();
  const importFn = useServerFn(bulkImportWithClassrooms);

  const [file, setFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState("");
  const [fallback, setFallback] = useState("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [missingClassroom, setMissingClassroom] = useState(false);
  const [detected, setDetected] = useState<string[]>([]);
  const [colleges, setColleges] = useState<string[]>([]);

  async function handleParse(f?: File, text?: string) {
    const result = f
      ? await parseFile(f, fallback || undefined)
      : parseCsvText(text ?? csvText, fallback || undefined);
    setRows(result.rows);
    setErrors(result.errors);
    setMissingClassroom(result.missingClassroom);
    setDetected(result.detectedPlatforms);
    setColleges(result.detectedColleges);
  }

  const mutation = useMutation({
    mutationFn: () => importFn({ data: { rows } }),
    onSuccess: (r) => {
      toast.success(
        `${r.studentsCreated} new students · ${r.studentsEnrolled} enrolled in another cohort · ${r.classroomsCreated} new classrooms`,
        {
          // The import no longer scrapes the first 5 rows inline and abandon the
          // rest — the whole batch is queued, so say so.
          description: [
            r.accountsWritten
              ? `${r.accountsWritten} platform handles imported (${Object.entries(r.platformCounts)
                  .map(([p, n]) => `${p} ${n}`)
                  .join(", ")}).`
              : null,
            r.queued
              ? `${r.queued} profiles queued for scraping. Progress shows in the bar at the top.`
              : "A refresh is already running — these students will be picked up on the next run.",
          ]
            .filter(Boolean)
            .join(" "),
        },
      );
      // An unknown college drops whole rows, so it gets its own visible error
      // rather than being buried in the success toast's description.
      if (r.collegeIssues?.length) {
        toast.error(
          `Unknown college: ${[...new Set(r.collegeIssues.map((c) => c.college))].join(", ")}`,
          {
            description:
              "Create the college first, then re-import. Affected classrooms were not created.",
          },
        );
      }
      qc.invalidateQueries({ queryKey: ["classrooms"] });
      qc.invalidateQueries({ queryKey: ["classroom"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["colleges"] });
      setFile(null);
      setCsvText("");
      setRows([]);
      onDone?.(r.studentsCreated + r.studentsEnrolled);
    },
    onError: (e) => toast.error(String(e)),
  });

  const grouped = groupBy(rows, (r) => r.classroom);

  return (
    <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/5 via-surface to-surface p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <Upload className="size-5 text-primary" /> Bulk Upload
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Drop a <b>CSV</b> or <b>Excel</b> file — students are auto-mapped to their classrooms.
            Missing classrooms are created. Add a column per platform to import those handles too,
            and a <b>college</b> column to file new classrooms under the right institution.
          </p>
        </div>
        <a
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(templateCsv())}`}
          download="template.csv"
          className="font-mono text-3xs uppercase tracking-widest text-primary hover:underline"
        >
          ↓ Template
        </a>
      </div>

      {/* Drop zone */}
      <label className="mb-3 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-background/50 px-4 py-8 transition-colors hover:border-primary/60 hover:bg-primary/5">
        <FileSpreadsheet className="size-8 text-muted-foreground" />
        <span className="text-sm">
          {file ? (
            <b className="text-foreground">{file.name}</b>
          ) : (
            <>
              Click to select <b>.csv / .xlsx / .xls</b>
            </>
          )}
        </span>
        <span className="text-center font-mono text-3xs uppercase tracking-widest text-muted-foreground">
          name · roll · email · classroom · college ·{" "}
          {PLATFORM_COLUMNS.map((p) => p.id).join(" · ")}
        </span>
        <input
          type="file"
          accept=".csv,.xlsx,.xls,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            if (f) handleParse(f);
          }}
        />
      </label>

      {/* Or paste */}
      <details className="mb-4">
        <summary className="cursor-pointer font-mono text-3xs uppercase tracking-widest text-muted-foreground hover:text-foreground">
          … or paste CSV text
        </summary>

        {/* The placeholder used to show two platforms out of ten, so pasting
            people copied that shape and their other handles were never imported.
            It is now generated from the same template the download button uses —
            one source of truth, and it cannot drift as platforms are added. */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const header = templateCsv().split("\n")[0];
              const next = csvText.trim() ? csvText : `${header}\n`;
              setCsvText(next);
              handleParse(undefined, next);
            }}
            className="rounded border border-border px-2 py-1 font-mono text-3xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Insert full header row
          </button>
          <span className="font-mono text-3xs text-muted-foreground">
            every column is optional except name, roll and one handle
          </span>
        </div>

        <textarea
          value={csvText}
          onChange={(e) => {
            setCsvText(e.target.value);
            handleParse(undefined, e.target.value);
          }}
          rows={6}
          className="mt-2 w-full rounded border border-border bg-background p-2 font-mono text-xs"
          placeholder={templateCsv()}
          spellCheck={false}
        />
      </details>

      {/* Fallback classroom if missing */}
      {missingClassroom && (
        <div className="mb-4 rounded border border-medium/30 bg-medium/5 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-medium">
            <AlertCircle className="size-4" /> No classroom column detected
          </div>
          <Label htmlFor="fb" className="text-xs">
            Classroom name for all rows
          </Label>
          <Input
            id="fb"
            value={fallback}
            onChange={(e) => {
              setFallback(e.target.value);
              if (file) handleParse(file);
              else if (csvText) handleParse(undefined, csvText);
            }}
            placeholder="e.g. CSE-2026"
            className="mt-1"
          />
        </div>
      )}

      {errors.length > 0 && (
        <div className="mb-4 rounded border border-hard/40 bg-hard/5 p-3 text-xs text-hard">
          {errors.join(" · ")}
        </div>
      )}

      {/* Which platform columns were recognised.
          Shown BEFORE importing, because a mistyped header ("code forces") is
          otherwise indistinguishable from "nobody filled that column in" — and
          you only find out after the handles are silently missing. */}
      {rows.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-3xs uppercase tracking-widest text-muted-foreground">
            Handle columns found:
          </span>
          {detected.length === 0 && (
            <span className="text-xs text-hard">none — check your header row</span>
          )}
          {PLATFORM_COLUMNS.filter((p) => detected.includes(p.id)).map((p) => {
            const n = rows.filter((r) => r.handles[p.id]).length;
            // A recognised column whose platform has no scraper is still worth
            // importing — but it is not the same as one that starts updating
            // tonight, and one green chip for both would say it is.
            const fetchable = isFetchable(p.id);
            return (
              <span
                key={p.id}
                title={fetchable ? undefined : statusNote(p.id, platformStatus(p.id, false))}
                className={
                  fetchable
                    ? "rounded border border-easy/40 bg-easy/10 px-1.5 py-0.5 font-mono text-3xs text-easy"
                    : "rounded border border-border px-1.5 py-0.5 font-mono text-3xs text-muted-foreground"
                }
              >
                {p.label} · {n}
                {!fetchable && <span className="ml-1 opacity-70">· not fetched</span>}
              </span>
            );
          })}
        </div>
      )}

      {/* Colleges named by the file. Same reasoning as the handle columns: a
          college that must already exist is worth showing before the import, not
          after it has dropped the rows that referenced it. */}
      {rows.length > 0 && colleges.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-3xs uppercase tracking-widest text-muted-foreground">
            Colleges named:
          </span>
          {colleges.map((c) => (
            <span
              key={c}
              className="rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-3xs text-primary"
            >
              {c}
            </span>
          ))}
          <span className="font-mono text-3xs text-muted-foreground">
            must already exist · only applied to new classrooms
          </span>
        </div>
      )}

      {/* Preview grouped by classroom */}
      {rows.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-easy">
            <CheckCircle2 className="size-4" /> {rows.length} students ·{" "}
            {Object.keys(grouped).length} classrooms detected
          </div>
          <div className="max-h-64 space-y-2 overflow-auto rounded border border-border bg-background p-2">
            {Object.entries(grouped).map(([cls, list]) => (
              <div key={cls} className="rounded border border-border bg-surface p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-mono text-2xs font-bold text-primary">{cls}</span>
                  <span className="font-mono text-3xs text-muted-foreground">
                    {list.length} students
                  </span>
                </div>
                <div className="font-mono text-3xs text-muted-foreground">
                  {list
                    .slice(0, 5)
                    .map((r) => r.name)
                    .join(" · ")}
                  {list.length > 5 ? ` · +${list.length - 5} more` : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Button
        disabled={rows.length === 0 || mutation.isPending}
        onClick={() => mutation.mutate()}
        className="w-full"
        size="lg"
      >
        <Upload className="mr-1 size-4" />
        {mutation.isPending
          ? "Importing…"
          : rows.length > 0
            ? `Import ${rows.length} students & scrape`
            : "Import"}
      </Button>
    </div>
  );
}

function groupBy<T, K extends string | number>(arr: T[], key: (t: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const item of arr) {
    const k = key(item);
    (out[k] ||= []).push(item);
  }
  return out;
}

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle } from "lucide-react";

import { bulkImportWithClassrooms } from "@/lib/bulk-import.functions";
import { parseFile, parseCsvText, type ParsedRow } from "@/lib/file-parser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function BulkUploader({ onDone }: { onDone?: (n: number) => void }) {
  const qc = useQueryClient();
  const importFn = useServerFn(bulkImportWithClassrooms);

  const [file, setFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState("");
  const [fallback, setFallback] = useState("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [missingClassroom, setMissingClassroom] = useState(false);

  async function handleParse(f?: File, text?: string) {
    const result = f
      ? await parseFile(f, fallback || undefined)
      : parseCsvText(text ?? csvText, fallback || undefined);
    setRows(result.rows);
    setErrors(result.errors);
    setMissingClassroom(result.missingClassroom);
  }

  const mutation = useMutation({
    mutationFn: () => importFn({ data: { rows } }),
    onSuccess: (r) => {
      toast.success(
        `Imported ${r.studentsUpserted} students · ${r.classroomsCreated} new classrooms`,
      );
      qc.invalidateQueries();
      setFile(null);
      setCsvText("");
      setRows([]);
      onDone?.(r.studentsUpserted);
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
            Drop a <b>CSV</b> or <b>Excel</b> file — students are auto-mapped to
            their classrooms. Missing classrooms are created.
          </p>
        </div>
        <a
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(
            "name,roll,email,leetcode_id,classroom\nJane Doe,CSE-01,jane@x.com,jane_dev,CSE-A\nJohn Smith,CSE-02,john@x.com,jsmith,CSE-A\nAsha Rao,ECE-15,asha@x.com,asha_r,ECE-B",
          )}`}
          download="template.csv"
          className="font-mono text-[10px] uppercase tracking-widest text-primary hover:underline"
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
            <>Click to select <b>.csv / .xlsx / .xls</b></>
          )}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Columns: name · roll · email · leetcode · classroom
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
        <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground">
          … or paste CSV text
        </summary>
        <textarea
          value={csvText}
          onChange={(e) => {
            setCsvText(e.target.value);
            handleParse(undefined, e.target.value);
          }}
          rows={6}
          className="mt-2 w-full rounded border border-border bg-background p-2 font-mono text-xs"
          placeholder={"name,roll,email,leetcode_id,classroom\nJane Doe,CSE-01,jane@x.com,jane_dev,CSE-A"}
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

      {/* Preview grouped by classroom */}
      {rows.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-easy">
            <CheckCircle2 className="size-4" /> {rows.length} students · {Object.keys(grouped).length} classrooms detected
          </div>
          <div className="max-h-64 space-y-2 overflow-auto rounded border border-border bg-background p-2">
            {Object.entries(grouped).map(([cls, list]) => (
              <div key={cls} className="rounded border border-border bg-surface p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-mono text-[11px] font-bold text-primary">
                    {cls}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {list.length} students
                  </span>
                </div>
                <div className="font-mono text-[10px] text-muted-foreground">
                  {list.slice(0, 5).map((r) => r.name).join(" · ")}
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

function groupBy<T, K extends string | number>(
  arr: T[],
  key: (t: T) => K,
): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const item of arr) {
    const k = key(item);
    (out[k] ||= []).push(item);
  }
  return out;
}

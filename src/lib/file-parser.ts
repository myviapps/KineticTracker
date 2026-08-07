// Client-side parser for CSV or Excel files → normalized rows.
//
// Columns are matched case-insensitively and punctuation-insensitively, because
// the files come from spreadsheets maintained by hand: "Roll No.", "roll_no" and
// "ROLL NUMBER" are all the same column, and insisting on one spelling just
// moves the work onto whoever assembled the sheet.
//
// Identity columns: name, roll, email, classroom, college
// Handle columns:   one per platform, all optional except LeetCode (see below)

import * as XLSX from "xlsx";

/**
 * Platform handle columns.
 *
 * Aliases are the header spellings actually seen in the wild plus the obvious
 * short forms. Order matters within a platform (first match wins) but not
 * between platforms — each is matched independently.
 *
 * The bare aliases "username" and "handle" stay on LeetCode: every existing
 * template uses them for LeetCode, and silently reassigning them to another
 * platform would repoint the scraper for an entire cohort.
 */
export const PLATFORM_COLUMNS: { id: string; label: string; aliases: string[] }[] = [
  {
    id: "leetcode",
    label: "LeetCode",
    aliases: [
      "leetcode",
      "leetcode id",
      "leetcode handle",
      "leetcode username",
      "lc",
      "lc id",
      "username",
      "handle",
    ],
  },
  {
    id: "codeforces",
    label: "Codeforces",
    aliases: ["codeforces", "codeforces id", "codeforces handle", "cf", "cf handle", "cf id"],
  },
  {
    id: "codechef",
    label: "CodeChef",
    aliases: ["codechef", "code chef", "codechef id", "codechef handle", "cc", "cc handle"],
  },
  {
    id: "hackerrank",
    label: "HackerRank",
    aliases: ["hackerrank", "hacker rank", "hackerrank id", "hackerrank handle", "hr", "hr handle"],
  },
  {
    id: "geeksforgeeks",
    label: "GeeksforGeeks",
    aliases: [
      "geeksforgeeks",
      "geeks for geeks",
      "gfg",
      "gfg id",
      "gfg handle",
      "geeksforgeeks id",
    ],
  },
  {
    id: "atcoder",
    label: "AtCoder",
    aliases: ["atcoder", "at coder", "atcoder id", "atcoder handle", "ac handle"],
  },
  {
    id: "hackerearth",
    label: "HackerEarth",
    aliases: ["hackerearth", "hacker earth", "hackerearth id", "he handle"],
  },
  /*
    SPOJ and InterviewBit are deliberately absent, and this is the list that
    decides what staff are OFFERED — the add-student form and the bulk-upload
    preview both derive their platform fields from it.

    MEASURED on 2026-08-05, which is why they were dropped rather than left
    greyed out:
      · SPOJ answers with a Cloudflare bot challenge that survives the render
        sidecar's solver (22.4s, challenge still present).
      · InterviewBit returns HTTP 200 for every handle, real or invented, and
        renders only site chrome behind a sign-in prompt — its public profiles
        went with the Scaler acquisition.
    Both are `blocked` in platform-capabilities.ts.

    Offering a column for either meant staff could type a handle that would
    never be fetched, and the profile would say "nothing fetched yet" forever —
    copy the app cannot honour. A column that is silently ignored on import is
    worse than one that was never advertised.

    An existing spreadsheet with a `spoj` column still imports cleanly: an
    unrecognised header is skipped, not an error. Handles already stored keep
    rendering on the profile with their blocked note (students.functions.ts
    unions in platforms a student already holds).
  */
  {
    id: "code360",
    label: "Code360",
    aliases: ["code360", "coding ninjas", "codingninjas", "naukri code360", "cn"],
  },
];

export type ParsedRow = {
  name: string;
  roll: string;
  email?: string;
  /** platform id → handle. Only platforms present in the file appear here. */
  handles: Record<string, string>;
  classroom: string;
  /**
   * College name or slug, when the file names one. Only consulted for classrooms
   * this import CREATES — an existing cohort keeps the college it already has,
   * because moving one silently would re-scope every rank derived from it.
   */
  college?: string;
};

const IDENTITY_ALIASES = {
  name: ["name", "student", "student name", "fullname", "full name"],
  roll: ["roll", "rollno", "roll no", "roll_no", "rollnumber", "roll number", "id", "student id"],
  email: ["email", "mail", "e-mail"],
  classroom: ["classroom", "class", "section", "cohort", "batch", "group"],
  // "institute"/"institution" are what Indian college spreadsheets usually say.
  // Not aliased to "school": that is a department name in several of these
  // sheets ("School of Engineering"), not the institution.
  college: ["college", "institute", "institution", "campus", "college name", "college slug"],
} as const;

/**
 * Fold a header to its comparable form.
 *
 * The trailing .trim() is load-bearing: separators are replaced with spaces, so
 * a header ending in one — "Roll No.", "Email:", "LeetCode_" — came out as
 * "roll no " and matched no alias at all. Spreadsheet headers end in a period
 * often enough that this silently dropped whole columns.
 */
function normalize(h: string) {
  return h
    .trim()
    .toLowerCase()
    .replace(/[_\-.:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickColumn(headers: string[], aliases: readonly string[]): number {
  const norm = headers.map(normalize);
  // Aliases are normalized too, so the table above can be written naturally
  // rather than pre-folded.
  for (const alias of aliases) {
    const idx = norm.indexOf(normalize(alias));
    if (idx >= 0) return idx;
  }
  return -1;
}

export type ParseResult = {
  rows: ParsedRow[];
  missingClassroom: boolean;
  errors: string[];
  /** Platform ids whose column was found, for the preview header. */
  detectedPlatforms: string[];
  /** Distinct college names named by the file, for the preview and validation. */
  detectedColleges: string[];
};

export async function parseFile(file: File, fallbackClassroom?: string): Promise<ParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  return normalizeRows(aoa, fallbackClassroom);
}

export function parseCsvText(text: string, fallbackClassroom?: string): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const aoa = lines.map((l) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, "")));
  return normalizeRows(aoa, fallbackClassroom);
}

function normalizeRows(aoa: unknown[][], fallbackClassroom?: string): ParseResult {
  const errors: string[] = [];
  if (aoa.length === 0) {
    return {
      rows: [],
      missingClassroom: false,
      errors: ["Empty file"],
      detectedPlatforms: [],
      detectedColleges: [],
    };
  }

  const headers = aoa[0].map((h) => String(h ?? ""));
  const iName = pickColumn(headers, IDENTITY_ALIASES.name);
  const iRoll = pickColumn(headers, IDENTITY_ALIASES.roll);
  const iEmail = pickColumn(headers, IDENTITY_ALIASES.email);
  const iCls = pickColumn(headers, IDENTITY_ALIASES.classroom);
  const iCollege = pickColumn(headers, IDENTITY_ALIASES.college);

  // Which platform columns this file actually has.
  const platformCols: { id: string; label: string; idx: number }[] = [];
  for (const p of PLATFORM_COLUMNS) {
    const idx = pickColumn(headers, p.aliases);
    if (idx >= 0) platformCols.push({ id: p.id, label: p.label, idx });
  }

  if (iName < 0) errors.push('Missing "name" column');
  if (iRoll < 0) errors.push('Missing "roll" column');
  if (platformCols.length === 0) {
    errors.push("No platform handle column found (e.g. leetcode, codeforces, codechef)");
  }

  const missingClassroom = iCls < 0;

  const rows: ParsedRow[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i];
    if (!r || r.every((c) => String(c ?? "").trim() === "")) continue;

    const name = String(r[iName] ?? "").trim();
    const roll = String(r[iRoll] ?? "").trim();
    const email = iEmail >= 0 ? String(r[iEmail] ?? "").trim() : "";
    const classroom =
      iCls >= 0 ? String(r[iCls] ?? "").trim() || fallbackClassroom || "" : fallbackClassroom || "";

    // A blank platform cell is normal, not an error — most students are not on
    // every platform, and demanding a value would force people to invent one.
    const handles: Record<string, string> = {};
    for (const p of platformCols) {
      const v = String(r[p.idx] ?? "").trim();
      if (v) handles[p.id] = v;
    }

    const college = iCollege >= 0 ? String(r[iCollege] ?? "").trim() : "";

    if (!name || !roll || !classroom) continue;
    if (Object.keys(handles).length === 0) continue; // no handles at all: nothing to track

    rows.push({
      name,
      roll,
      email: email || undefined,
      handles,
      classroom,
      college: college || undefined,
    });
  }

  const detectedColleges = [
    ...new Set(rows.map((r) => r.college).filter((c): c is string => !!c)),
  ].sort();

  return {
    rows,
    missingClassroom,
    errors,
    detectedPlatforms: platformCols.map((p) => p.id),
    detectedColleges,
  };
}

/**
 * A ready-to-fill template with every supported column, for the uploader.
 *
 * Built from a column→value map rather than two positional arrays. The previous
 * form padded a hand-written example to `header.length` with a slice, so adding
 * a column shifted every value after it into the wrong header — the sample row
 * would have told people to put a handle in the classroom column.
 */
export function templateCsv(): string {
  const example: Record<string, string> = {
    name: "Aarav Sharma",
    roll: "24CS001",
    email: "aarav@college.edu",
    classroom: "CSE-2028",
    college: "CMRTC",
    leetcode: "aarav_lc",
    codeforces: "aarav_cf",
  };

  const header = [
    "name",
    "roll",
    "email",
    "classroom",
    "college",
    ...PLATFORM_COLUMNS.map((p) => p.id),
  ];

  return `${header.join(",")}\n${header.map((h) => example[h] ?? "").join(",")}\n`;
}

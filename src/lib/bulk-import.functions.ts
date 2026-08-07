import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireRole } from "@/lib/authz";
import { optionalEmail } from "@/lib/validation";

const Row = z.object({
  name: z.string().trim().min(1).max(100),
  roll: z.string().trim().min(1).max(50),
  email: optionalEmail,
  classroom: z.string().trim().min(1).max(100),
  /** College name or slug. Only used when this import CREATES the classroom. */
  college: z.string().trim().min(1).max(200).optional().nullable(),
  /** platform id -> handle. Only the platforms present in the file. */
  handles: z.record(z.string(), z.string().trim().min(1).max(100)),
});

const Input = z.object({
  rows: z.array(Row).min(1).max(2000),
});

export const bulkImportWithClassrooms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  .validator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing } = await supabaseAdmin.from("classrooms").select("id, name");
    const byName = new Map<string, string>();
    for (const c of existing ?? []) byName.set(c.name.toLowerCase(), c.id);

    const uniqueNames = Array.from(new Set(data.rows.map((r) => r.classroom.trim())));
    const toCreate = uniqueNames.filter((n) => !byName.has(n.toLowerCase()));

    /*
      Which college each NEW classroom belongs to.

      Only new ones: an existing cohort keeps the college it already has, even if
      the file names a different one. Silently moving a classroom between
      institutions would re-scope every college rank derived from it, and a
      spreadsheet typo is not the place to decide that.

      A named college must already exist. Unknown names are reported rather than
      created — same principle as resolveCollegeId, which throws instead of
      guessing: inventing an institution from a misspelled cell is far more
      expensive to undo than fixing the cell.
    */
    const collegeIssues: { classroom: string; college: string }[] = [];
    let createdCount = 0;

    if (toCreate.length) {
      const { resolveCollegeId } = await import("./colleges.server");

      // Take the first non-empty college named for each new classroom.
      const namedCollege = new Map<string, string>();
      for (const r of data.rows) {
        const key = r.classroom.trim().toLowerCase();
        if (r.college && !namedCollege.has(key)) namedCollege.set(key, r.college.trim());
      }

      const { data: colleges } = await supabaseAdmin.from("colleges").select("id, name, slug");
      // Matched on name OR slug, case-insensitively — the slug exists precisely
      // so a spreadsheet column survives a display-name change (20260808000007).
      const collegeByKey = new Map<string, string>();
      for (const c of colleges ?? []) {
        collegeByKey.set(c.name.trim().toLowerCase(), c.id);
        collegeByKey.set(c.slug.trim().toLowerCase(), c.id);
      }

      // The fallback for rows that name no college: the importer's own.
      // Resolved lazily so a file that names a college for every new classroom
      // does not fail on a multi-college install where the fallback is ambiguous.
      let fallbackCollegeId: string | null = null;
      const fallback = async () => {
        if (!fallbackCollegeId) {
          fallbackCollegeId = await resolveCollegeId({ userId: context.userId });
        }
        return fallbackCollegeId;
      };

      const inserts: { name: string; college_id: string }[] = [];
      for (const name of toCreate) {
        const named = namedCollege.get(name.toLowerCase());
        if (named) {
          const id = collegeByKey.get(named.toLowerCase());
          if (!id) {
            collegeIssues.push({ classroom: name, college: named });
            continue;
          }
          inserts.push({ name, college_id: id });
        } else {
          inserts.push({ name, college_id: await fallback() });
        }
      }

      if (inserts.length) {
        const { data: created, error } = await supabaseAdmin
          .from("classrooms")
          .insert(inserts)
          .select("id, name");
        if (error) throw new Error(error.message);
        for (const c of created ?? []) byName.set(c.name.toLowerCase(), c.id);
        createdCount = created?.length ?? 0;
      }
    }

    /*
      Two dedup keys, because they mean different things now.

      A student is identified by `roll` alone, so the STUDENT payload dedups on
      roll (last row wins). But the whole point of the feature is that one roll may
      appear under two classroom names in the same file — so MEMBERSHIPS are the
      union of every (roll, classroom) pair, not a deduped-away duplicate.
    */
    const byRoll = new Map<string, (typeof data.rows)[number]>();
    // roll -> the classrooms that roll appears under in this file. A Map of Sets
    // rather than a delimited string key: rolls are free text and any separator
    // chosen here would eventually appear inside one.
    const wantedMemberships = new Map<string, Set<string>>();
    // Rows whose classroom could not be created (unknown college). Reported, not
    // silently dropped — the non-null assertion that used to be here would have
    // put `undefined` into the membership set and failed the insert for the whole
    // file instead of just these rows.
    const orphanRows: { roll: string; reason: string }[] = [];

    for (const r of data.rows) {
      const roll = r.roll.trim();
      const cid = byName.get(r.classroom.toLowerCase());
      if (!cid) {
        const issue = collegeIssues.find(
          (c) => c.classroom.toLowerCase() === r.classroom.trim().toLowerCase(),
        );
        orphanRows.push({
          roll,
          reason: issue
            ? `Unknown college "${issue.college}" — create it first, then re-import`
            : `Classroom "${r.classroom}" could not be created`,
        });
        continue;
      }
      byRoll.set(roll, r);
      const set = wantedMemberships.get(roll);
      if (set) set.add(cid);
      else wantedMemberships.set(roll, new Set([cid]));
    }
    const rolls = [...byRoll.keys()];

    // Never blind-update an existing student: an upsert keyed on the now-global
    // `roll` would silently overwrite the name and LeetCode handle of anyone whose
    // roll appears in the file, repointing the scraper. Existing rolls are only
    // ever enrolled into the named classroom.
    const { data: existingStudents, error: lookupErr } = await supabaseAdmin
      .from("students")
      .select("id, roll")
      .in("roll", rolls)
      .order("created_at", { ascending: true });
    if (lookupErr) throw new Error(lookupErr.message);
    // Keep the FIRST (oldest) row per roll: a roll can still map to several
    // students until Phase 2 adds UNIQUE(roll), and this must agree with the
    // record getStudentByRoll resolves to.
    const idByRoll = new Map<string, string>();
    for (const s of existingStudents ?? []) {
      if (!idByRoll.has(s.roll)) idByRoll.set(s.roll, s.id);
    }

    const newRolls = rolls.filter((r) => !idByRoll.has(r));

    /*
      A NEW student still needs a LeetCode handle, because students.leetcode_id
      is NOT NULL until that column is retired. Rows without one are reported
      rather than silently dropped — "nothing happened and I don't know why" is
      the worst possible import outcome. An EXISTING student has no such
      constraint: their other-platform handles import fine.
    */
    const lcHandles = newRolls
      .map((r) => byRoll.get(r)!.handles.leetcode?.trim().toLowerCase())
      .filter((h): h is string => !!h);
    const { data: handleRows } = lcHandles.length
      ? await supabaseAdmin
          .from("students")
          .select("roll, leetcode_id")
          .in("leetcode_id", lcHandles)
      : { data: [] as { roll: string; leetcode_id: string }[] };
    const takenHandle = new Map((handleRows ?? []).map((s) => [s.leetcode_id, s.roll]));

    const skipped: { roll: string; reason: string }[] = [];
    const toInsert: { name: string; roll: string; email: string | null; leetcode_id: string }[] =
      [];
    const seenHandle = new Set<string>();

    for (const roll of newRolls) {
      const r = byRoll.get(roll)!;
      const handle = r.handles.leetcode?.trim().toLowerCase();
      if (!handle) {
        skipped.push({
          roll,
          reason:
            "New students need a LeetCode handle; other platforms alone cannot create a record yet",
        });
        continue;
      }
      const owner = takenHandle.get(handle);
      if (owner) {
        skipped.push({ roll, reason: `LeetCode ID "${handle}" already belongs to ${owner}` });
        continue;
      }
      if (seenHandle.has(handle)) {
        skipped.push({ roll, reason: `LeetCode ID "${handle}" is used twice in this file` });
        continue;
      }
      seenHandle.add(handle);
      toInsert.push({
        name: r.name,
        roll,
        email: r.email && r.email.length > 0 ? r.email : null,
        leetcode_id: handle,
      });
    }

    if (toInsert.length) {
      const { data: created, error } = await supabaseAdmin
        .from("students")
        .insert(toInsert)
        .select("id, roll");
      if (error) throw new Error(error.message);
      for (const s of created ?? []) idByRoll.set(s.roll, s.id);
    }

    // Every surviving (roll, classroom) pair becomes a membership. This is the step
    // that puts a student into a second cohort.
    const memberships: { student_id: string; classroom_id: string }[] = [];
    for (const [roll, classroomIds] of wantedMemberships) {
      const studentId = idByRoll.get(roll);
      if (!studentId) continue;
      for (const classroomId of classroomIds) {
        memberships.push({ student_id: studentId, classroom_id: classroomId });
      }
    }
    if (memberships.length) {
      const { error: memErr } = await supabaseAdmin
        .from("classroom_students")
        .upsert(memberships, { onConflict: "classroom_id,student_id", ignoreDuplicates: true });
      if (memErr) throw new Error(memErr.message);
    }

    /*
      Handles for every OTHER platform.

      LeetCode is skipped: the sync trigger on students.leetcode_id already
      maintains that account row, and inserting it again here would race it.

      `ignoreDuplicates` rather than merge, deliberately. A re-import must not
      overwrite a handle an admin has since corrected by hand in the UI — the
      spreadsheet is usually the STALER source, and silently reverting a manual
      fix is the kind of bug nobody reports because nobody sees it happen.
    */
    const accountRows: {
      student_id: string;
      platform_id: string;
      handle: string;
      status: string;
    }[] = [];
    const platformCounts: Record<string, number> = {};
    for (const [roll, r] of byRoll) {
      const studentId = idByRoll.get(roll);
      if (!studentId) continue;
      for (const [platformId, rawHandle] of Object.entries(r.handles)) {
        if (platformId === "leetcode") continue;
        const handle = rawHandle.trim();
        if (!handle) continue;
        accountRows.push({
          student_id: studentId,
          platform_id: platformId,
          handle,
          status: "unverified",
        });
        platformCounts[platformId] = (platformCounts[platformId] ?? 0) + 1;
      }
    }

    let accountsWritten = 0;
    const platformErrors: string[] = [];
    if (accountRows.length) {
      // Chunked: a 2000-row file across 5 platforms is 10k account rows, which is
      // past what one PostgREST request should carry.
      for (let i = 0; i < accountRows.length; i += 500) {
        const slice = accountRows.slice(i, i + 500);
        const { error } = await supabaseAdmin
          .from("student_platform_accounts")
          .upsert(slice, { onConflict: "student_id,platform_id", ignoreDuplicates: true });
        if (error) {
          // One platform's handles failing must not lose the students themselves,
          // which are already committed above.
          platformErrors.push(error.message);
        } else {
          accountsWritten += slice.length;
        }
      }
    }

    const rows = [...new Set(memberships.map((m) => m.student_id))].map((id) => ({ id }));

    // This used to scrape the first 5 rows inline (with a 1.5s sleep between
    // each), which both risked the serverless timeout on a large import and left
    // every remaining student unscraped until somebody noticed and hit Refresh.
    // Queue the whole batch and let the background pump work through it.
    const ids = (rows ?? []).map((r) => r.id);
    let queued = 0;
    if (ids.length > 0) {
      const { enqueueRefreshFanOut } = await import("./refresh-enqueue.server");
      // A refresh already in flight is not a reason to fail the import — the rows
      // are saved either way, they just wait for the next run. The fan-out never
      // throws for that case, it reports the platform as skipped.
      const { queued: jobs } = await enqueueRefreshFanOut({
        scope: "students",
        studentIds: ids,
        createdBy: context.userId,
      });
      if (jobs.length > 0) queued = ids.length;
    }

    return {
      studentsCreated: toInsert.length,
      studentsEnrolled: rows.length - toInsert.length,
      membershipsWritten: memberships.length,
      classroomsCreated: createdCount,
      classroomsTotal: uniqueNames.length,
      accountsWritten,
      platformCounts,
      platformErrors,
      // Rows dropped for a bad college land in the same list the caller already
      // renders, so an unknown institution surfaces the same way a missing
      // LeetCode handle does rather than vanishing.
      skipped: [...skipped, ...orphanRows],
      collegeIssues,
      queued,
    };
  });

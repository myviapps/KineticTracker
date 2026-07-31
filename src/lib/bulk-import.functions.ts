import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireRole } from "@/lib/authz";

const Row = z.object({
  name: z.string().trim().min(1).max(100),
  roll: z.string().trim().min(1).max(50),
  email: z.string().trim().max(200).optional().nullable(),
  leetcode_id: z.string().trim().min(1).max(100),
  classroom: z.string().trim().min(1).max(100),
});

const Input = z.object({
  rows: z.array(Row).min(1).max(2000),
});

export const bulkImportWithClassrooms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  .validator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing } = await supabaseAdmin
      .from("classrooms")
      .select("id, name");
    const byName = new Map<string, string>();
    for (const c of existing ?? []) byName.set(c.name.toLowerCase(), c.id);

    const uniqueNames = Array.from(
      new Set(data.rows.map((r) => r.classroom.trim())),
    );
    const toCreate = uniqueNames.filter((n) => !byName.has(n.toLowerCase()));
    let createdCount = 0;
    if (toCreate.length) {
      const { data: created, error } = await supabaseAdmin
        .from("classrooms")
        .insert(toCreate.map((name) => ({ name })))
        .select("id, name");
      if (error) throw new Error(error.message);
      for (const c of created ?? []) byName.set(c.name.toLowerCase(), c.id);
      createdCount = created?.length ?? 0;
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
    for (const r of data.rows) {
      const roll = r.roll.trim();
      byRoll.set(roll, r);
      const cid = byName.get(r.classroom.toLowerCase())!;
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
    const handles = newRolls.map((r) => byRoll.get(r)!.leetcode_id.trim().toLowerCase());
    const { data: handleRows } = handles.length
      ? await supabaseAdmin.from("students").select("roll, leetcode_id").in("leetcode_id", handles)
      : { data: [] as { roll: string; leetcode_id: string }[] };
    const takenHandle = new Map((handleRows ?? []).map((s) => [s.leetcode_id, s.roll]));

    const skipped: { roll: string; reason: string }[] = [];
    const toInsert: { name: string; roll: string; email: string | null; leetcode_id: string }[] = [];
    const seenHandle = new Set<string>();

    for (const roll of newRolls) {
      const r = byRoll.get(roll)!;
      const handle = r.leetcode_id.trim().toLowerCase();
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

    const rows = [...new Set(memberships.map((m) => m.student_id))].map((id) => ({ id }));

    // This used to scrape the first 5 rows inline (with a 1.5s sleep between
    // each), which both risked the serverless timeout on a large import and left
    // every remaining student unscraped until somebody noticed and hit Refresh.
    // Queue the whole batch and let the background pump work through it.
    const ids = (rows ?? []).map((r) => r.id);
    let queued = 0;
    if (ids.length > 0) {
      const { error: jobError } = await supabaseAdmin.rpc("enqueue_refresh_job", {
        p_scope: "students",
        p_student_ids: ids,
        p_created_by: context.userId,
      });
      // A refresh already in flight is not a reason to fail the import — the rows
      // are saved either way, they just wait for the next run.
      if (!jobError) queued = ids.length;
    }

    return {
      studentsCreated: toInsert.length,
      studentsEnrolled: rows.length - toInsert.length,
      membershipsWritten: memberships.length,
      classroomsCreated: createdCount,
      classroomsTotal: uniqueNames.length,
      skipped,
      queued,
    };
  });

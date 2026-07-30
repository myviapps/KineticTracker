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

    const keyed = new Map<string, (typeof data.rows)[number]>();
    for (const r of data.rows) {
      const key = `${byName.get(r.classroom.toLowerCase())!}:${r.roll}`;
      keyed.set(key, r);
    }
    const payload = Array.from(keyed.values()).map((r) => ({
      classroom_id: byName.get(r.classroom.toLowerCase())!,
      name: r.name,
      roll: r.roll,
      email: r.email && r.email.length > 0 ? r.email : null,
      leetcode_id: r.leetcode_id,
    }));
    const { data: rows, error } = await supabaseAdmin
      .from("students")
      .upsert(payload, { onConflict: "classroom_id,roll" })
      .select("id, leetcode_id");
    if (error) throw new Error(error.message);

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
      studentsUpserted: rows?.length ?? 0,
      classroomsCreated: createdCount,
      classroomsTotal: uniqueNames.length,
      queued,
    };
  });

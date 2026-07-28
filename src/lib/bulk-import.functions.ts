import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth, requireAdmin } from "@/integrations/supabase/auth-middleware";

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
  .middleware([requireSupabaseAuth, requireAdmin])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
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

    const { scrapeStudentById } = await import("./scrape.server");
    const INLINE_SCRAPE_LIMIT = 5;
    let scraped = 0;
    let scrapeFailed = 0;
    for (const r of (rows ?? []).slice(0, INLINE_SCRAPE_LIMIT)) {
      try {
        await scrapeStudentById(r.id);
        scraped += 1;
        await new Promise((res) => setTimeout(res, 1500));
      } catch (e) {
        console.error(`Scrape failed for ${r.id}: ${e instanceof Error ? e.message : String(e)}`);
        scrapeFailed += 1;
      }
    }

    return {
      studentsUpserted: rows?.length ?? 0,
      classroomsCreated: createdCount,
      classroomsTotal: uniqueNames.length,
      scraped,
      scrapeFailed,
      pending: Math.max(0, (rows?.length ?? 0) - scraped - scrapeFailed),
    };
  });

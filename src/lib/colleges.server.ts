// Server-only college helpers.
//
// classrooms.college_id became NOT NULL in 20260808000007, so every creation
// path now has to name a college. Until the UI has a college picker, that answer
// is resolved here rather than being hardcoded at three separate call sites.

/**
 * Which college a new classroom belongs to.
 *
 * Resolution order, most specific first:
 *   1. an explicit id from the caller
 *   2. the creator's single assigned college (a CEO creating in their own)
 *   3. the only college that exists (the single-tenant case, which is today)
 *
 * Deliberately THROWS when a multi-college install gives no hint, instead of
 * silently picking the oldest. Guessing would file a cohort under the wrong
 * institution, and every rank and rollup downstream inherits that mistake.
 */
export async function resolveCollegeId(
  opts: { explicit?: string | null; userId?: string | null } = {},
): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  if (opts.explicit) {
    const { data } = await supabaseAdmin
      .from("colleges")
      .select("id")
      .eq("id", opts.explicit)
      .maybeSingle();
    if (!data) throw new Error("Unknown college");
    return data.id;
  }

  if (opts.userId) {
    const { data: assigned } = await supabaseAdmin
      .from("college_assignments")
      .select("college_id")
      .eq("user_id", opts.userId);
    if (assigned?.length === 1) return assigned[0].college_id;
  }

  const { data: all } = await supabaseAdmin.from("colleges").select("id, name").limit(2);
  if (!all || all.length === 0) {
    throw new Error("No college exists — create one before adding classrooms");
  }
  if (all.length > 1) {
    throw new Error("Multiple colleges exist — a college must be specified for this classroom");
  }
  return all[0].id;
}

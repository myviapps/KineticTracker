import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireRole } from "@/lib/authz";

/**
 * Every staff account used to be created with — and every password reset used to
 * restore — the same hardcoded literal ("Cmrtc@leetcode"). Knowing one account's
 * initial password meant knowing every account's, forever, including the admin's.
 *
 * Now: 18 characters from a CSPRNG, one guaranteed character per class so the
 * result always satisfies a typical password policy, shown to the admin exactly
 * once at creation.
 */
const LOWER = "abcdefghijkmnopqrstuvwxyz"; // no l
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I, O
const DIGIT = "23456789"; // no 0, 1
const SYMBOL = "!@#$%^&*-_=+";
const ALL = LOWER + UPPER + DIGIT + SYMBOL;

function randomInt(max: number): number {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0xffffffff / max) * max;
  let v: number;
  do {
    crypto.getRandomValues(buf);
    v = buf[0];
  } while (v >= limit); // reject the biased tail
  return v % max;
}

function pick(set: string): string {
  return set[randomInt(set.length)];
}

function generateTempPassword(): string {
  const required = [pick(LOWER), pick(UPPER), pick(DIGIT), pick(SYMBOL)];
  const rest = Array.from({ length: 14 }, () => pick(ALL));
  const chars = [...required, ...rest];
  // Fisher-Yates, so the guaranteed classes aren't always in the first 4 slots.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export const listStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Get all users with roles
    const { data: userRoles } = await supabaseAdmin.from("user_roles").select("id, user_id, role");

    // Get all faculty assignments
    const { data: assignments } = await supabaseAdmin
      .from("faculty_assignments")
      .select("faculty_user_id, classroom_id");

    // Map assignments by user
    const assignmentsByUser = new Map<string, string[]>();
    for (const a of assignments ?? []) {
      const list = assignmentsByUser.get(a.faculty_user_id) ?? [];
      list.push(a.classroom_id);
      assignmentsByUser.set(a.faculty_user_id, list);
    }

    const staffList = await Promise.all(
      (userRoles ?? []).map(async (ur) => {
        let email = "unknown";
        try {
          const { data: u } = await supabaseAdmin.auth.admin.getUserById(ur.user_id);
          email = u?.user?.email ?? "unknown";
        } catch (e) {
          // Degrading to "unknown" is intentional — one unreadable auth record
          // must not blank the whole staff table. But it used to degrade
          // SILENTLY, so a systematically broken lookup looked identical to a
          // single missing user.
          console.warn(`[staff] could not resolve email for ${ur.user_id}:`, e);
        }
        return {
          id: ur.id,
          user_id: ur.user_id,
          email,
          role: ur.role,
          classroom_ids: assignmentsByUser.get(ur.user_id) ?? [],
        };
      }),
    );

    return staffList;
  });

export const createStaffUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  .validator((d: unknown) =>
    z
      .object({
        email: z.string().email(),
        name: z.string().min(1),
        role: z.enum(["admin", "placement_officer", "faculty"]),
        classroom_ids: z.array(z.string().uuid()).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const password = generateTempPassword();
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password,
      email_confirm: true,
      user_metadata: { name: data.name },
    });
    if (createError) throw new Error(createError.message);
    if (!newUser.user) throw new Error("Failed to create user");

    // Insert role
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: newUser.user.id, role: data.role });
    if (roleError) throw new Error(roleError.message);

    // If faculty, assign classrooms
    if (data.role === "faculty" && data.classroom_ids?.length) {
      const { error: assignError } = await supabaseAdmin.from("faculty_assignments").insert(
        data.classroom_ids.map((cid) => ({
          faculty_user_id: newUser.user.id,
          classroom_id: cid,
        })),
      );
      if (assignError) throw new Error(assignError.message);
    }

    return { user_id: newUser.user.id, tempPassword: password };
  });

/**
 * Permanently deletes the account. Two guards that were missing: an admin could
 * delete their own account mid-session, and could delete the last remaining admin,
 * leaving the install with no way to reach /staff, /settings or a platform refresh
 * ever again.
 */
export const deactivateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  .validator((d: { user_id: string }) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.user_id === context.userId) {
      throw new Error("You cannot deactivate your own account");
    }

    const { data: targetRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user_id);
    const targetIsAdmin = (targetRoles ?? []).some((r) => r.role === "admin");

    if (targetIsAdmin) {
      const { count } = await supabaseAdmin
        .from("user_roles")
        .select("user_id", { count: "exact", head: true })
        .eq("role", "admin");
      if ((count ?? 0) <= 1) {
        throw new Error("Cannot deactivate the last remaining admin account");
      }
    }

    await supabaseAdmin.from("faculty_assignments").delete().eq("faculty_user_id", data.user_id);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);

    return { ok: true };
  });

export const resetStaffPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  .validator((d: { user_id: string }) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const password = generateTempPassword();
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      password,
    });
    if (error) throw new Error(error.message);

    // Returned so the admin can pass it on. The UI used to claim the password had
    // been set to the user's email address, which was never what happened.
    return { ok: true, tempPassword: password };
  });

export const assignFacultyToClassroom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  .validator((d: unknown) =>
    z
      .object({
        faculty_user_id: z.string().uuid(),
        classroom_id: z.string().uuid(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin
      .from("faculty_assignments")
      .insert({ faculty_user_id: data.faculty_user_id, classroom_id: data.classroom_id });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const unassignFaculty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  .validator((d: unknown) =>
    z
      .object({
        faculty_user_id: z.string().uuid(),
        classroom_id: z.string().uuid(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin
      .from("faculty_assignments")
      .delete()
      .eq("faculty_user_id", data.faculty_user_id)
      .eq("classroom_id", data.classroom_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const forceReleaseRefreshLock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Cancel any active job instead of deleting refresh_locks rows
    const { data: active } = await supabaseAdmin
      .from("refresh_jobs")
      .select("id")
      .in("status", ["queued", "running", "paused"])
      .limit(1)
      .maybeSingle();

    if (active) {
      await supabaseAdmin
        .from("refresh_jobs")
        .update({
          status: "cancelled",
          finished_at: new Date().toISOString(),
          lease_owner: null,
          lease_until: null,
        })
        .eq("id", active.id);
    }

    return { ok: true };
  });

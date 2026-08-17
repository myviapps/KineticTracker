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

    // College oversight, for the roles scoped by it. Returned alongside the
    // classroom assignments so the staff page can show what a CEO or a scoped
    // placement officer can actually reach.
    const { data: collegeRows } = await supabaseAdmin
      .from("college_assignments")
      .select("user_id, college_id");
    const collegesByUser = new Map<string, string[]>();
    for (const a of collegeRows ?? []) {
      const list = collegesByUser.get(a.user_id) ?? [];
      list.push(a.college_id);
      collegesByUser.set(a.user_id, list);
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
          college_ids: collegesByUser.get(ur.user_id) ?? [],
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
        role: z.enum(["admin", "placement_officer", "faculty", "ceo"]),
        classroom_ids: z.array(z.string().uuid()).optional(),
        /*
          Colleges this user oversees. Meaningful for ceo and placement_officer;
          the CEO role could not be created here at all before, and there was no
          server function anywhere that wrote college_assignments — so both the
          role and its scoping were SQL-only operations.
        */
        college_ids: z.array(z.string().uuid()).optional(),
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

    // Colleges, for the roles that are scoped by them.
    if ((data.role === "ceo" || data.role === "placement_officer") && data.college_ids?.length) {
      const { error: collegeError } = await supabaseAdmin.from("college_assignments").insert(
        data.college_ids.map((cid) => ({
          user_id: newUser.user.id,
          college_id: cid,
        })),
      );
      if (collegeError) throw new Error(collegeError.message);
    }

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

    /*
      Cross-college assignment is allowed, but no longer silent.

      This inserted the pair with no validation at all, so an admin could give a
      faculty member a cohort in a college they have nothing to do with — and
      that faculty then saw its students, ranks and reports, because faculty
      scoping reads faculty_assignments without consulting the college.

      It is not forbidden: co-taught and visiting arrangements are real, and
      refusing would make them impossible. What was wrong is that it happened
      invisibly. The result now reports whether the assignment crossed a college
      boundary so the UI can say so at the moment it is made.
    */
    const [{ data: room }, { data: existing }] = await Promise.all([
      supabaseAdmin
        .from("classrooms")
        .select("college_id, name")
        .eq("id", data.classroom_id)
        .maybeSingle(),
      supabaseAdmin
        .from("faculty_assignments")
        .select("classroom_id")
        .eq("faculty_user_id", data.faculty_user_id),
    ]);
    if (!room) throw new Error("Classroom not found");

    let crossCollege = false;
    const otherIds = (existing ?? []).map((a) => a.classroom_id);
    if (otherIds.length > 0 && room.college_id) {
      const { data: theirRooms } = await supabaseAdmin
        .from("classrooms")
        .select("college_id")
        .in("id", otherIds);
      // Only a boundary if they already hold cohorts and none share this college.
      const colleges = new Set((theirRooms ?? []).map((r) => r.college_id).filter(Boolean));
      crossCollege = colleges.size > 0 && !colleges.has(room.college_id);
    }

    const { error } = await supabaseAdmin
      .from("faculty_assignments")
      .insert({ faculty_user_id: data.faculty_user_id, classroom_id: data.classroom_id });
    if (error) throw new Error(error.message);
    return { ok: true, crossCollege, classroomName: room.name };
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

/**
 * Grant or revoke a user's oversight of a college.
 *
 * `college_assignments` had two read sites and no write site anywhere in the
 * application, so a CEO could only be scoped in SQL — and for a placement
 * officer the row was silently inert until scoping was implemented. This is the
 * missing half.
 *
 * Deliberately not restricted to one role. The table is keyed on user_id and
 * both CEO and placement officer are scoped by it; refusing other roles here
 * would only mean the check has to be repeated wherever the table is read.
 */
export const setCollegeAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  .validator((d: unknown) =>
    z
      .object({
        user_id: z.string().uuid(),
        college_id: z.string().uuid(),
        assigned: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.assigned) {
      // Upsert, not insert: re-granting an existing assignment is a no-op
      // rather than a duplicate-key error the caller has to interpret.
      const { error } = await supabaseAdmin
        .from("college_assignments")
        .upsert(
          { user_id: data.user_id, college_id: data.college_id },
          { onConflict: "user_id,college_id", ignoreDuplicates: true },
        );
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("college_assignments")
        .delete()
        .eq("user_id", data.user_id)
        .eq("college_id", data.college_id);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

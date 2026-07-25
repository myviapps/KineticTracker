import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Cryptographically strong one-time password shown to the admin once. */
function generateTempPassword(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/[^a-zA-Z0-9]/g, "");
  // Guarantee length + mixed classes regardless of how the base64 stripped out.
  return `Kx7${b64.slice(0, 20)}!q`;
}

export const listStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    
    // Check caller is admin
    const { data: callerRole } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (callerRole?.role !== "admin") throw new Error("Forbidden");

    // Get all users with roles
    const { data: userRoles } = await supabaseAdmin
      .from("user_roles")
      .select("id, user_id, role");

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
        } catch {}
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
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    email: z.string().email(),
    name: z.string().min(1),
    role: z.enum(["admin", "placement_officer", "faculty"]),
    classroom_ids: z.array(z.string().uuid()).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Check caller is admin
    const { data: callerRole } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (callerRole?.role !== "admin") throw new Error("Forbidden");

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
      const { error: assignError } = await supabaseAdmin
        .from("faculty_assignments")
        .insert(data.classroom_ids.map((cid) => ({
          faculty_user_id: newUser.user.id,
          classroom_id: cid,
        })));
      if (assignError) throw new Error(assignError.message);
    }

    return { user_id: newUser.user.id, tempPassword: password };
  });

export const deactivateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string }) => z.object({ user_id: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: callerRole } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (callerRole?.role !== "admin") throw new Error("Forbidden");

    await supabaseAdmin.from("faculty_assignments").delete().eq("faculty_user_id", data.user_id);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);

    return { ok: true };
  });

export const resetStaffPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string }) =>
    z.object({ user_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Verify caller is admin
    const { data: callerRole } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (callerRole?.role !== "admin") throw new Error("Forbidden");

    const password = generateTempPassword();
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      password,
    });
    if (error) throw new Error(error.message);

    return { ok: true, tempPassword: password };
  });

export const assignFacultyToClassroom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    faculty_user_id: z.string().uuid(),
    classroom_id: z.string().uuid(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: callerRole } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (callerRole?.role !== "admin") throw new Error("Forbidden");

    const { error } = await supabaseAdmin
      .from("faculty_assignments")
      .insert({ faculty_user_id: data.faculty_user_id, classroom_id: data.classroom_id });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const unassignFaculty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    faculty_user_id: z.string().uuid(),
    classroom_id: z.string().uuid(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: callerRole } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (callerRole?.role !== "admin") throw new Error("Forbidden");

    const { error } = await supabaseAdmin
      .from("faculty_assignments")
      .delete()
      .eq("faculty_user_id", data.faculty_user_id)
      .eq("classroom_id", data.classroom_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const forceReleaseRefreshLock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: callerRole } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (callerRole?.role !== "admin") throw new Error("Forbidden");

    await supabaseAdmin.from("refresh_locks").delete().eq("lock_key", "global");
    await supabaseAdmin.from("refresh_locks").delete().eq("lock_key", "global_all");
    return { ok: true };
  });

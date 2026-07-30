/**
 * Single source of truth for authorization.
 *
 * Before this module every server function hand-rolled its own role check with
 * `.from("user_roles").select("role").eq("user_id", id).maybeSingle()`. That was
 * copied nine times and had two bugs baked into every copy:
 *
 *   1. `maybeSingle()` on a table keyed `(user_id, role)` returns
 *      `{ data: null, error: PGRST116 }` as soon as a user holds TWO roles. The
 *      error was discarded, so `role` became null and the user was treated as
 *      having no access at all — while `getCurrentUserClient` (which resolves
 *      multi-role correctly) happily rendered them the full admin UI.
 *   2. The nine copies drifted. A placement officer could refresh a classroom
 *      through `refreshClassroom` but not through `enqueueRefresh`.
 *
 * Everything here resolves roles the same way the client does: read ALL rows,
 * take the most privileged. Server functions import the helpers below instead of
 * querying `user_roles` themselves.
 *
 * Lazy `await import(".../client.server")` inside each function is deliberate
 * and matches `auth-middleware.ts` — a top-level import would pull the
 * service-role client into the browser bundle.
 */
import { createMiddleware } from "@tanstack/react-start";
import type { AppRole } from "@/integrations/supabase/types";

/** Most privileged last. Used to collapse multi-role users to one effective role. */
const ROLE_RANK: Record<AppRole, number> = {
  faculty: 1,
  placement_officer: 2,
  admin: 3,
};

async function admin() {
  const mod = await import("@/integrations/supabase/client.server");
  return mod.supabaseAdmin;
}

/**
 * The caller's effective role, or null if they hold none.
 * Reads every row — never `.maybeSingle()`. See the note at the top of the file.
 */
export async function resolveRole(userId: string): Promise<AppRole | null> {
  const supabaseAdmin = await admin();
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);

  if (error) throw new Error("Could not resolve role");

  let best: AppRole | null = null;
  for (const row of data ?? []) {
    const role = row.role as AppRole;
    if (!best || ROLE_RANK[role] > ROLE_RANK[best]) best = role;
  }
  return best;
}

// ─── Capability predicates ──────────────────────────────────────────────────
// Named after the action, not the role, so call sites read as intent and the
// policy for an action lives in exactly one place.

/** Create/delete classrooms, manage staff, change settings, platform refresh. */
export const canAdminister = (role: AppRole | null) => role === "admin";

/** Add / edit / delete students, and refresh a classroom. */
export const canManageStudents = (role: AppRole | null) =>
  role === "admin" || role === "faculty";

/** See every classroom rather than only assigned ones. */
export const canViewAllClassrooms = (role: AppRole | null) =>
  role === "admin" || role === "placement_officer";

// ─── Scoping ────────────────────────────────────────────────────────────────

/**
 * Classroom ids the caller may read. `null` means "no restriction" — callers
 * must treat null as all-access and skip their `.in()` filter entirely.
 */
export async function accessibleClassroomIds(
  userId: string,
  role: AppRole | null,
): Promise<string[] | null> {
  if (canViewAllClassrooms(role)) return null;
  if (role !== "faculty") return [];

  const supabaseAdmin = await admin();
  const { data } = await supabaseAdmin
    .from("faculty_assignments")
    .select("classroom_id")
    .eq("faculty_user_id", userId);
  return (data ?? []).map((a) => a.classroom_id);
}

/** Throws "Forbidden" unless the caller may read/act on this classroom. */
export async function assertClassroomAccess(
  userId: string,
  role: AppRole | null,
  classroomId: string,
): Promise<void> {
  if (canViewAllClassrooms(role)) return;
  if (role !== "faculty") throw new Error("Forbidden");

  const supabaseAdmin = await admin();
  const { data: assignment } = await supabaseAdmin
    .from("faculty_assignments")
    .select("classroom_id")
    .eq("faculty_user_id", userId)
    .eq("classroom_id", classroomId)
    .maybeSingle();
  if (!assignment) throw new Error("Forbidden: not assigned to this classroom");
}

/** Same as assertClassroomAccess, resolving the classroom from a student id. */
export async function assertStudentAccess(
  userId: string,
  role: AppRole | null,
  studentId: string,
): Promise<void> {
  if (canViewAllClassrooms(role)) return;

  const supabaseAdmin = await admin();
  const { data: student } = await supabaseAdmin
    .from("students")
    .select("classroom_id")
    .eq("id", studentId)
    .maybeSingle();
  if (!student) throw new Error("Student not found");
  await assertClassroomAccess(userId, role, student.classroom_id);
}

// ─── Optional authentication ────────────────────────────────────────────────

export type Viewer = { userId: string; role: AppRole | null };

/**
 * Resolves the caller if they happen to be signed in, and returns null if they
 * are not — WITHOUT throwing.
 *
 * `requireSupabaseAuth` is all-or-nothing, which is wrong for the public student
 * lookup: that page has to serve anonymous visitors a masked profile and signed-in
 * staff the full one. Same request path, two audiences.
 */
export async function resolveOptionalViewer(): Promise<Viewer | null> {
  const { getRequest } = await import("@tanstack/react-start/server");
  const request = getRequest();

  const authHeader = request?.headers?.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice("Bearer ".length);
  if (!token || token.split(".").length !== 3) return null;

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return null;

  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.getClaims(token);
    const userId = data?.claims?.sub;
    if (error || !userId) return null;
    return { userId, role: await resolveRole(userId) };
  } catch {
    // A malformed or expired token is an anonymous viewer, not a 500.
    return null;
  }
}

/** True when this viewer may see unmasked identity fields for the classroom. */
export async function viewerHasClassroomAccess(
  viewer: Viewer | null,
  classroomId: string,
): Promise<boolean> {
  if (!viewer?.role) return false;
  try {
    await assertClassroomAccess(viewer.userId, viewer.role, classroomId);
    return true;
  } catch {
    return false;
  }
}

// ─── Middleware ─────────────────────────────────────────────────────────────

/**
 * What `requireSupabaseAuth` + `withRole`/`requireRole` put on a handler's
 * context. TanStack doesn't thread middleware context types through to the
 * handler signature, so handlers read it with `authContext(context)` rather than
 * each one casting to `any`.
 */
export type AuthContext = { userId: string; role: AppRole };

/** Narrow a handler's `context` to what the auth middleware guarantees. */
export function authContext(context: unknown): AuthContext {
  return context as AuthContext;
}

type MiddlewareArgs = {
  next: (opts: { context: Record<string, unknown> }) => Promise<unknown>;
  context: Record<string, unknown>;
};

async function attachRole(
  { next, context }: MiddlewareArgs,
  allowed: AppRole[] | null,
) {
  const userId = context.userId as string;
  const role = (context.role as AppRole | undefined) ?? (await resolveRole(userId));
  if (!role) throw new Error("Forbidden: no role assigned");
  if (allowed && !allowed.includes(role)) throw new Error("Forbidden");
  return next({ context: { ...context, role } });
}

/**
 * Gate a server function on role. Chain AFTER requireSupabaseAuth:
 *   .middleware([requireSupabaseAuth, requireRole("admin")])
 * Puts the resolved role on context so the handler doesn't re-query.
 */
export const requireRole = (...allowed: AppRole[]) =>
  createMiddleware({ type: "function" }).server(
    (args) => attachRole(args as unknown as MiddlewareArgs, allowed) as never,
  );

/**
 * Resolves the role onto context WITHOUT gating — for handlers that serve every
 * role but scope their data by it.
 */
export const withRole = createMiddleware({ type: "function" }).server(
  (args) => attachRole(args as unknown as MiddlewareArgs, null) as never,
);

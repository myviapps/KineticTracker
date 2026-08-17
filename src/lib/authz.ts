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
import { createMiddleware, createServerOnlyFn } from "@tanstack/react-start";
import type { AppRole } from "@/integrations/supabase/app-role";

/** Most privileged last. Used to collapse multi-role users to one effective role. */
const ROLE_RANK: Record<AppRole, number> = {
  faculty: 1,
  placement_officer: 2,
  // A CEO oversees whole institutions, so they outrank a placement officer — but
  // only within the colleges assigned to them. The breadth of their reach is
  // enforced by college_assignments, not by this number; this only decides which
  // single role a multi-role user is reported as.
  ceo: 3,
  admin: 4,
};

/**
 * The service-role client, fetched lazily so a top-level import never pulls it
 * into the browser bundle.
 *
 * Wrapped in createServerOnlyFn as defence in depth. The build already strips
 * this correctly — a production build was checked and none of the 89 client
 * assets reference supabaseAdmin, SUPABASE_SERVICE_ROLE_KEY or the key itself —
 * but "correctly stripped" is a property of the bundler, not of this code. If
 * that ever regresses, this throws loudly on the client instead of quietly
 * handing a browser a key that bypasses every RLS policy.
 */
const admin = createServerOnlyFn(async () => {
  const mod = await import("@/integrations/supabase/client.server");
  return mod.supabaseAdmin;
});

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
export const canManageStudents = (role: AppRole | null) => role === "admin" || role === "faculty";

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
  if (role === "admin") return null;

  const supabaseAdmin = await admin();

  /*
    College-scoped roles: CEO and placement officer.

    A CEO sees every classroom of every college assigned to them — broader than
    faculty, narrower than admin. Returning [] rather than null when they have
    no assignment is deliberate: an unassigned CEO must see nothing.

    A placement officer used to short-circuit on canViewAllClassrooms and see
    EVERY college unconditionally, ignoring college_assignments entirely — so a
    row assigning one to a college was silently inert, and the moment a second
    college held data, an officer for one could read the other's students,
    rolls, handles, ranks and reports. They now scope exactly like a CEO.

    The one asymmetry is the unassigned case, and it is deliberate. An
    unassigned CEO is a misconfiguration — the role exists to oversee named
    colleges. An unassigned placement officer is the CURRENT state of every such
    account here, and narrowing them to [] would silently blank the pages they
    use today. Unassigned therefore keeps the old platform-wide reach; assigning
    a college is what opts an officer into scoping. Assign one to make it bite.
  */
  if (role === "ceo" || role === "placement_officer") {
    const { data: colleges } = await supabaseAdmin
      .from("college_assignments")
      .select("college_id")
      .eq("user_id", userId);
    const collegeIds = (colleges ?? []).map((c) => c.college_id);

    if (collegeIds.length === 0) return role === "ceo" ? [] : null;

    const { data } = await supabaseAdmin
      .from("classrooms")
      .select("id")
      .in("college_id", collegeIds);
    return (data ?? []).map((c) => c.id);
  }

  if (role !== "faculty") return [];

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

  const supabaseAdmin = await admin();

  // Delegated to SQL rather than re-implemented here, so the CEO rule lives in
  // exactly one place and cannot drift from the RLS policies that use it.
  if (role === "ceo") {
    const { data, error } = await supabaseAdmin.rpc("has_classroom_access", {
      _user: userId,
      _classroom: classroomId,
    });
    // Fail closed: a transport error must not read as "allowed".
    if (error || !data) throw new Error("Forbidden: classroom not in an assigned college");
    return;
  }

  if (role !== "faculty") throw new Error("Forbidden");
  const { data: assignment } = await supabaseAdmin
    .from("faculty_assignments")
    .select("classroom_id")
    .eq("faculty_user_id", userId)
    .eq("classroom_id", classroomId)
    .maybeSingle();
  if (!assignment) throw new Error("Forbidden: not assigned to this classroom");
}

/**
 * Throws "Forbidden" unless the caller may act on this student.
 *
 * A student belongs to a SET of classrooms, so the rule is intersection: ANY
 * overlap between the student's classrooms and the caller's assignments grants
 * access.
 *
 * This calls the same `has_student_access` predicate the RLS policies use rather
 * than reimplementing the intersection here. Two copies of an authorization rule
 * drift, and when they do, the service-role path and the anon-key path start
 * disagreeing about who can see what — while only one of them is ever tested.
 *
 * The old "Student not found" branch is gone on purpose: it was an existence
 * oracle over the entire student directory, keyed by uuid. Faculty now get one
 * indistinguishable Forbidden either way.
 */
export async function assertStudentAccess(
  userId: string,
  role: AppRole | null,
  studentId: string,
): Promise<void> {
  // Fast path. The predicate agrees — it returns true for both these roles — but
  // this saves a round trip on the majority case.
  if (canViewAllClassrooms(role)) return;
  // 'ceo' must fall THROUGH to the predicate, not be rejected here. has_student_access
  // grants a CEO any student in an assigned college; short-circuiting on
  // `role !== "faculty"` would deny them every student while the RLS policy said yes —
  // the two-copies-of-one-rule drift this function exists to avoid.
  if (role !== "faculty" && role !== "ceo") throw new Error("Forbidden");

  const supabaseAdmin = await admin();
  const { data: allowed, error } = await supabaseAdmin.rpc("has_student_access", {
    _user: userId,
    _student: studentId,
  });

  // Fail closed. A transport error is not permission.
  if (error) throw new Error("Forbidden");
  if (!allowed) throw new Error("Forbidden: not assigned to this student's classroom");
}

/**
 * Classroom ids this student belongs to, filtered to what the caller may see.
 *
 * The filtering is the point: a faculty member must not learn that one of their
 * students is also enrolled in a cohort they aren't assigned to.
 */
export async function visibleClassroomsForStudent(
  userId: string,
  role: AppRole | null,
  studentId: string,
): Promise<{ id: string; name: string }[]> {
  const supabaseAdmin = await admin();
  const allowed = await accessibleClassroomIds(userId, role);
  if (allowed !== null && allowed.length === 0) return [];

  let query = supabaseAdmin
    .from("classroom_students")
    .select("classroom_id, classrooms(name)")
    .eq("student_id", studentId);
  if (allowed !== null) query = query.in("classroom_id", allowed);

  const { data, error } = await query;
  if (error) return [];

  return (data ?? [])
    .map((row) => ({
      id: row.classroom_id,
      name: (row.classrooms as { name: string } | null)?.name ?? "",
    }))
    .filter((c) => c.name)
    .sort((a, b) => a.name.localeCompare(b.name));
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
export const resolveOptionalViewer = createServerOnlyFn(async (): Promise<Viewer | null> => {
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
});

/**
 * True when this viewer may see unmasked identity fields for this student.
 *
 * Student-based rather than classroom-based since the migration: a student has
 * several classrooms, and being able to see them in any one roster makes masking
 * them on their own profile theatre.
 */
export async function viewerHasStudentAccess(
  viewer: Viewer | null,
  studentId: string,
): Promise<boolean> {
  if (!viewer?.role) return false;
  try {
    await assertStudentAccess(viewer.userId, viewer.role, studentId);
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

async function attachRole({ next, context }: MiddlewareArgs, allowed: AppRole[] | null) {
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

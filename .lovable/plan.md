## Roles & access

| Role | Home | Scope | Actions |
|---|---|---|---|
| **Admin** | `/admin` | Everything | Full CRUD; create faculty accounts; assign faculty↔classroom; bulk import; refresh; delete |
| **Placement Officer** | `/overview` | Whole college, read-only | View all cohorts, cross-classroom charts, export |
| **Faculty** | `/dashboard` | Only assigned classrooms | View + Refresh (subject to global lock) |
| **Public / Student** | `/` | Public read | Search by roll/email/name/leetcode → student profile |

Students are **not** users. Staff sign-in = email/password **and** Google. Admin manually creates faculty & placement-officer accounts (signup disabled).

## Public landing (`/`)

- Large hero search bar → server fn `searchStudents(q)` matches roll / email prefix / name / leetcode_id (case-insensitive, min 2 chars, debounced).
- Results list → click → `/students/$roll` (existing profile, made public read-only, no edit affordances).
- Top-right "Staff sign in" → `/auth`.
- No sidebar, no classroom list, no upload. Fresh clean marketing-style page.

## Staff app (`/_authenticated/*`)

```text
/_authenticated/dashboard              role-aware landing
/_authenticated/overview               admin + placement officer
/_authenticated/classrooms             list (scoped)
/_authenticated/classrooms/$id         detail (scoped) — tabs unchanged
/_authenticated/_admin/classrooms/new  admin only
/_authenticated/_admin/import          admin only (bulk upload moves here)
/_authenticated/_admin/staff           admin only — create/list/deactivate faculty & PO, assign faculty↔classroom
```

Nested `_admin` pathless layout gates via `has_role(uid,'admin')`.

## Refresh mutex (global, cross-faculty)

New table `refresh_locks` (single-row semantics per lock key):

```text
lock_key text pk         -- 'global'
classroom_id uuid        -- which classroom is refreshing
started_by uuid          -- user id
started_at timestamptz
expires_at timestamptz   -- started_at + 10 min safety TTL
```

Server fn `refreshClassroom` flow:
1. `INSERT ... ON CONFLICT (lock_key) DO NOTHING` for `lock_key='global'` with expiry = now+10min.
2. If insert returned 0 rows AND existing row's `expires_at > now()` → throw `{ code: 'REFRESH_BUSY', busyClassroomId, busyClassroomName, startedBy, startedAt }`.
3. Otherwise (fresh insert or stale lock re-taken) → run scrape loop for that classroom only.
4. `finally` → delete the lock row.

UI on every classroom's Refresh button:
- Poll `getRefreshStatus()` every 5s while page mounted.
- If lock held elsewhere: disable button, show banner *"Another refresh is running (Classroom X, started by Y, ~N min ago). Please wait a few minutes."*
- If lock held on this classroom: show progress spinner + "Refreshing… started HH:MM".

Admin has same UI but can also **force-release** the lock from `/admin/staff` (in case of a stuck worker).

## Faculty account creation (admin only)

- `/admin/staff` page: list users + form to invite faculty/PO.
- Server fn `createStaffUser({ email, name, role, classroomIds[] })` (admin only):
  - `supabaseAdmin.auth.admin.createUser({ email, password: random, email_confirm: true })`
  - Insert into `user_roles`.
  - If role=faculty: insert rows into `faculty_assignments`.
  - Returns generated temp password (shown once to admin to hand over) — or triggers password-reset email (pick one; recommend "email reset link" so admin never sees passwords).
- Reassign / unassign classrooms from same page.

## Data model migration

```sql
create type app_role as enum ('admin','placement_officer','faculty');

create table user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  unique(user_id, role)
);

create table faculty_assignments (
  faculty_user_id uuid not null references auth.users(id) on delete cascade,
  classroom_id uuid not null references classrooms(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (faculty_user_id, classroom_id)
);

create table refresh_locks (
  lock_key text primary key,
  classroom_id uuid not null,
  started_by uuid not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- SECURITY DEFINER helpers
has_role(_user uuid, _role app_role) -> bool
has_classroom_access(_user uuid, _classroom uuid) -> bool
  -- true if has_role(admin) OR has_role(placement_officer)
  -- OR exists row in faculty_assignments
```

**RLS retightening** on existing tables:
- Drop the current broad `public read` policies.
- Add:
  - Public SELECT via **views** projecting safe columns only (`students_public` hides `email`; `student_stats_public` unchanged; `classrooms_public` unchanged).
  - Authenticated SELECT on base tables gated by `has_classroom_access(auth.uid(), classroom_id)`.
- Public search + public student profile query the `_public` views through a publishable-key server client.
- Grants: `authenticated` gets SELECT on base tables; `anon` gets SELECT only on the views; `service_role` full.

Admin email seeded via migration: inserts `user_roles(admin)` for the auth user whose email matches — created lazily by a trigger `on_auth_user_created` so it works whether the admin signs up before or after migration.

## Server-function changes

Add `.middleware([requireSupabaseAuth])` + explicit role checks:

- **Admin-only**: `createClassroom`, `deleteClassroom`, `bulkImportClassrooms`, `seedMockClassroom`, `createStaffUser`, `assignFacultyToClassroom`, `unassignFaculty`, `listStaff`, `deactivateUser`, `forceReleaseRefreshLock`.
- **Admin or faculty-with-access**: `refreshClassroom`, `refreshStudent`, `addStudent`, `bulkAddStudents`, `deleteStudent`.
- **Scoped reads** (`listClassrooms`, `getClassroom`, `getOverview`): filter by `has_classroom_access`.
- **New public** (no middleware, publishable client): `searchStudents(q)`, `getPublicStudent(roll)`, `getRefreshStatus()`.

## Student profile fixes (`/students/$roll`)

Reported issues: **Languages and Skills empty, layout misaligned, whitespace gaps.**

- **Languages / skills broken** — root cause: `language_stats` / `tag_stats` are stored as JSON strings from LeetCode's GraphQL, and the profile page reads them as objects. Fix in `leetcode.server.ts` to normalize both to `{ languageName, problemsSolved }[]` and `{ fundamental[], intermediate[], advanced[] }` before saving, and update the profile page's rendering accordingly. Verify with the demo cohort.
- **Layout** — rebuild `/students/$roll` on a responsive 12-col grid:
  - Row 1: sticky header card (avatar, name, roll, classroom badge, LeetCode link, refresh button if permitted).
  - Row 2 (lg): 4 KPI tiles (Total, Rank, Streak, Contest rating). Stack 2×2 on mobile.
  - Row 3: 8-col heatmap card + 4-col difficulty breakdown card.
  - Row 4: 6-col Languages, 6-col Skills (tabs: Advanced / Intermediate / Fundamental) — no more empty state when data exists.
  - Row 5: 8-col "Solved over time" line chart + 4-col Badges grid.
  - Row 6: full-width Recent submissions table.
- Kill leftover whitespace by wrapping each card in `Card` with consistent `p-6`, removing empty `min-h` shims, and using `gap-6` grid spacing.
- Add `EmptyState` component for cards with no data (contest never taken, no badges, no recent) instead of blank rectangles.

## Sidebar & overview scoping

- Sidebar reads current role from route context (loaded once in `_authenticated/route.tsx`).
- Faculty: only their assigned classrooms + Dashboard.
- Placement officer: all classrooms (read-only badge) + Overview.
- Admin: all + Import + Staff.
- Overview page filters its aggregates by the same role scope.

## Build order

1. Migration: enums, `user_roles`, `faculty_assignments`, `refresh_locks`, helpers, admin-email trigger, public views, retightened RLS.
2. `supabase--configure_auth` disable signups; `supabase--configure_social_auth` enable Google.
3. Move existing routes under `_authenticated/`, keep `/students/$roll` public, replace `/` with landing + search.
4. Add role middleware, scope every server fn, wire refresh mutex + `getRefreshStatus`.
5. Admin staff page (create faculty, assign classrooms, force-release lock).
6. Fix `/students/$roll`: language/skill parsing + responsive layout rebuild + empty states.
7. Sidebar + overview scoping per role.
8. Verify with admin / PO / faculty test accounts and public search.

## One thing I need before starting

**What email should be seeded as the admin?** (I'll bake it into the migration + first-login trigger so the moment you sign in with that email you're admin.)

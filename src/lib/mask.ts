/**
 * PII masking for the public student lookup.
 *
 * `/students/$roll` is reachable without signing in so a student can check their
 * own progress from the landing page. The LeetCode activity on that page is
 * public information anyway (solve counts, heatmap, contests, badges), but the
 * identity columns we store alongside it are not — a full name, an institutional
 * email and a handle that usually contains the person's real name should not be
 * readable by anyone who can guess a roll number.
 *
 * So: identity is masked for viewers without classroom access, activity is not.
 * Pure functions, no server imports — safe to use on either side.
 */

const DOTS = "•••";

/** "Aarav Sharma" -> "Aarav S." · single-word names are returned unchanged. */
export function maskName(name: string | null | undefined): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** "aarav.sharma@demo.edu" -> "aa•••@demo.edu" */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at <= 0) return DOTS;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const keep = local.slice(0, Math.min(2, local.length));
  return `${keep}${DOTS}${domain}`;
}

/** "aarav_sharma" -> "aa•••ma" · keeps enough to be recognisable, not resolvable. */
export function maskHandle(handle: string | null | undefined): string {
  if (!handle) return "—";
  const h = handle.trim();
  if (h.length <= 4) return `${h.slice(0, 1)}${DOTS}`;
  return `${h.slice(0, 2)}${DOTS}${h.slice(-2)}`;
}

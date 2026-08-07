import { z } from "zod";

/**
 * Optional student email, shared by every path that accepts one.
 *
 * Previously there were two contradictory versions: the single-add and update
 * paths validated the format (`.email()`), while `bulkAddStudents` and
 * `bulkImportWithClassrooms` accepted any string up to 200 chars. So the same
 * value was rejected when typed into the form and accepted when pasted into a
 * spreadsheet, and the database ended up holding both.
 *
 * Accepts: omitted, null, "" (all meaning "no email"), or a valid address.
 * Callers already normalise "" to null before insert.
 *
 * Note for bulk callers: a malformed address now fails the whole batch, but the
 * ZodError path names the offending row (e.g. `rows.12.email`), so the admin can
 * find and fix it.
 */
export const optionalEmail = z
  .string()
  .trim()
  .max(200)
  .email()
  .or(z.literal(""))
  .nullable()
  .optional();

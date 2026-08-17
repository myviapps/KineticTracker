// Server-only: the two ways a large PostgREST read silently returns the wrong
// answer, and the one helper that avoids both.
//
// ── 1. The URL length ceiling ───────────────────────────────────────────────
// `.in("student_id", ids)` puts every id in the query string. A uuid plus its
// comma is 37 bytes, so an institution-wide 489-student read builds an ~18KB
// URL and the request does not merely truncate — it fails outright with an
// opaque `TypeError: fetch failed`. Callers that destructure `{ data }` and
// ignore `error` then treat the failure as "no rows", which is how the
// performance panel reported "0 solved this week" while the table held 549.
//
// ── 2. The row ceiling ──────────────────────────────────────────────────────
// PostgREST caps every response at `db-max-rows` — 1000 on this project —
// regardless of the Range header. Several call sites pass `.range(0, 49_999)`
// with a comment claiming it prevents truncation. It does not: the request
// succeeds and quietly returns the first 1000 rows. A 30-day snapshot window is
// 6000+ rows, so those reads were losing five sixths of their data.
//
// Both failures are silent and both produce plausible-looking numbers, which is
// what makes them worth a shared helper rather than a fix per call site.

/** Ids per `.in()` — 100 uuids is ~3.7KB of query string, well inside limits. */
const IN_CHUNK = 100;

/** Must not exceed the server's db-max-rows, or paging stalls a page early. */
const PAGE = 1000;

type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/**
 * Every row matching `ids`, chunked under the URL limit and paged past the row
 * limit. Throws on any error rather than returning a short list, because a
 * partial answer here is indistinguishable from a real one.
 *
 * `run` receives a chunk of ids and a half-open row range to apply via
 * `.range(from, to)`.
 */
export async function fetchAllIn<T>(
  ids: string[],
  run: (batch: string[], from: number, to: number) => PageResult<T>,
  label = "query",
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const batch = ids.slice(i, i + IN_CHUNK);
    let from = 0;
    // Page until a short page proves the chunk is exhausted. Bounded by the
    // `data.length < PAGE` break, not by a guessed maximum.
    for (;;) {
      const { data, error } = await run(batch, from, from + PAGE - 1);
      if (error) throw new Error(`${label}: ${error.message}`);
      const rows = data ?? [];
      out.push(...rows);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
  }
  return out;
}

/**
 * The same paging for a read with no `.in()` filter.
 */
export async function fetchAllPaged<T>(
  run: (from: number, to: number) => PageResult<T>,
  label = "query",
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await run(from, from + PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

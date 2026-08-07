import type { Database } from "./types";

/**
 * The application's role union.
 *
 * This lives in its own file because it USED to be a hand-written line at the
 * top of types.ts — a file whose first instruction is "automatically generated,
 * do not edit". Running `npm run gen-types` silently deleted it and broke every
 * importer, which is a failure mode that repeats every single regeneration.
 *
 * Derived from the generated enum rather than re-typed, so adding a role to the
 * app_role enum in Postgres propagates here automatically instead of drifting.
 */
export type AppRole = Database["public"]["Enums"]["app_role"];

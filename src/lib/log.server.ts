/**
 * Server-side structured logging for the refresh pipeline.
 *
 * Every line is prefixed and timed so a run can be followed in the dev-server
 * terminal or in `vercel logs`. Set REFRESH_DEBUG=0 to silence everything but
 * warnings and errors.
 */
const ENABLED = process.env.REFRESH_DEBUG !== "0";

const C = {
  dim: (s: string) => `\x1b[90m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  grn: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yel: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyn: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

function ts() {
  return C.dim(new Date().toISOString().slice(11, 23));
}

function fmt(scope: string, msg: string, data?: unknown) {
  const tail =
    data === undefined
      ? ""
      : " " +
        C.dim(
          typeof data === "string"
            ? data
            : Object.entries(data as Record<string, unknown>)
                .map(
                  ([k, v]) =>
                    `${k}=${typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}`,
                )
                .join(" "),
        );
  return `${ts()} ${C.cyn(`[${scope}]`)} ${msg}${tail}`;
}

export const log = {
  info(scope: string, msg: string, data?: unknown) {
    if (ENABLED) console.log(fmt(scope, msg, data));
  },
  ok(scope: string, msg: string, data?: unknown) {
    if (ENABLED) console.log(fmt(scope, C.grn(msg), data));
  },
  warn(scope: string, msg: string, data?: unknown) {
    console.warn(fmt(scope, C.yel(msg), data));
  },
  error(scope: string, msg: string, err?: unknown) {
    const e = err as
      | { name?: string; message?: string; stack?: string; kind?: string; status?: number }
      | undefined;
    console.error(
      fmt(scope, C.red(msg), {
        name: e?.name ?? typeof err,
        kind: e?.kind ?? "-",
        status: e?.status ?? "-",
        message: (e?.message ?? String(err ?? "")).slice(0, 300),
      }),
    );
    if (e?.stack) console.error(C.dim(e.stack.split("\n").slice(1, 5).join("\n")));
  },
  /** Times an awaited step and logs how long it took. */
  async time<T>(scope: string, label: string, fn: () => Promise<T>): Promise<T> {
    const t = Date.now();
    try {
      const out = await fn();
      log.info(scope, `${label} ${C.dim(`${Date.now() - t}ms`)}`);
      return out;
    } catch (e) {
      log.error(scope, `${label} FAILED after ${Date.now() - t}ms`, e);
      throw e;
    }
  },
};

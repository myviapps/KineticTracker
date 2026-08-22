import { CircleCheck, TriangleAlert } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Ingestion health, as a badge in the sticky bar.
 *
 * This was a full-width panel sitting between the stat cards and the charts —
 * permanent furniture for a question you ask occasionally ("did the scrape
 * work?") and never while reading the roster. It is status, not page content,
 * so it belongs next to the other chrome, with the detail one click away.
 *
 * Silent when everything is fine: a green "0 failed" bar every single load
 * trains people to stop reading it, which is exactly when you need them to.
 */
export function ScrapeStatusBadge({
  students,
}: {
  students: {
    id: string;
    roll: string;
    leetcode_id: string;
    last_scraped_at: string | null;
    scrape_error: string | null;
  }[];
}) {
  const pending = students.filter((s) => !s.last_scraped_at).length;
  const failed = students.filter((s) => s.scrape_error).length;
  const scraped = students.length - pending;
  const latest = students
    .map((s) => s.last_scraped_at)
    .filter((v): v is string => !!v)
    .sort()
    .at(-1);
  const errors = students.filter((s) => s.scrape_error).slice(0, 8);

  const clean = pending === 0 && failed === 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-3xs transition-colors",
            clean
              ? "border-border text-muted-foreground hover:text-foreground"
              : failed > 0
                ? "border-hard/40 bg-hard/10 text-hard"
                : "border-medium/40 bg-medium/10 text-medium",
          )}
          title="Scraping status"
        >
          {clean ? (
            <>
              <CircleCheck className="size-3" aria-hidden /> synced
            </>
          ) : (
            <>
              <TriangleAlert className="size-3" aria-hidden />
              {pending > 0 && `${pending} pending`}
              {pending > 0 && failed > 0 && " · "}
              {failed > 0 && `${failed} failed`}
            </>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80">
        <div className="space-y-2 text-sm">
          <div className="font-mono text-3xs uppercase tracking-widest text-muted-foreground">
            Scraping status
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="text-easy">
              ✓ Scraped <b className="font-mono">{scraped}</b>
            </span>
            <span className="text-medium">
              ⏳ Pending <b className="font-mono">{pending}</b>
            </span>
            <span className="text-hard">
              ✕ Failed <b className="font-mono">{failed}</b>
            </span>
          </div>

          {latest && (
            <p className="text-xs text-muted-foreground">
              Last run <span className="font-mono">{new Date(latest).toLocaleString()}</span>
            </p>
          )}

          {pending > 0 && (
            <p className="text-xs text-muted-foreground">
              Click <b>Refresh all</b> to scrape pending students.
            </p>
          )}

          {errors.length > 0 && (
            <div className="border-t border-border pt-2">
              <ul className="space-y-1 font-mono text-2xs text-muted-foreground">
                {errors.map((s) => (
                  <li key={s.id}>
                    <span className="text-foreground">{s.roll}</span> · {s.leetcode_id} —{" "}
                    {s.scrape_error}
                  </li>
                ))}
                {failed > errors.length && <li>… and {failed - errors.length} more</li>}
              </ul>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

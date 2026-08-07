import { motion } from "@/components/landing/reveal";

/**
 * Mock leaderboard for the showcase. Deliberately NOT `LeaderboardBars` — that
 * component links every row to /students/$roll, and with fabricated names
 * those would be dead links to "Student not found". These are static rows:
 * same bar markup, no navigation.
 *
 * Rows cascade in and the bars grow to their widths after the rows land.
 * Names are masked-style ("Aarav S.") — the showcase shows the product shape,
 * not a directory of real students.
 */
const ROWS = [
  { name: "Aarav S.", roll: "CSE-26-014", solved: 143 },
  { name: "Priya K.", roll: "CSE-26-031", solved: 128 },
  { name: "Rahul M.", roll: "CSE-26-022", solved: 96 },
  { name: "Sneha P.", roll: "CSE-26-047", solved: 87 },
  { name: "Arjun T.", roll: "CSE-26-003", solved: 71 },
] as const;

const MAX = 150;

export function ShowcaseLeaderboard() {
  return (
    <motion.div
      className="flex flex-col"
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-40px" }}
    >
      <div className="mb-3 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Classroom leaderboard
      </div>
      <div className="flex flex-col gap-2.5">
        {ROWS.map((r, i) => (
          <motion.div
            key={r.roll}
            className="flex items-center gap-3"
            variants={{
              hidden: { opacity: 0, x: -10 },
              visible: { opacity: 1, x: 0, transition: { delay: i * 0.07, duration: 0.4 } },
            }}
          >
            <span className="w-6 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium">{r.name}</span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                  {r.solved}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                <motion.div
                  className="h-full rounded-full bg-primary/80"
                  variants={{
                    hidden: { width: "0%" },
                    visible: {
                      width: `${(r.solved / MAX) * 100}%`,
                      transition: {
                        delay: i * 0.07 + 0.35,
                        duration: 0.7,
                        ease: [0.16, 1, 0.3, 1],
                      },
                    },
                  }}
                />
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

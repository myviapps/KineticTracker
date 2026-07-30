<div align="center">
  <img src="public/logo-almanac.svg" width="120" height="120" alt="Almanac logo">
</div>

# Almanac

**Track, analyze, and motivate student LeetCode activity across classrooms and cohorts.**

Almanac is a full-stack classroom analytics platform that monitors competitive programming progress on LeetCode. Built for educators, placement officers, and training programs who want data-driven visibility into their students' practice habits.

## Features

- **LeetCode Integration** — Scrapes public LeetCode profiles (GraphQL) for solved counts, submission calendars, contest ratings, badges, language stats, and more.
- **Classroom Management** — Create cohorts, bulk-import students from CSV/Excel, and assign faculty oversight.
- **Role-Based Access** — `admin` (full control), `placement_officer` (cross-classroom analytics), `faculty` (assigned classrooms).
- **Dashboards & Reports** — Leaderboards, behavioral buckets ("Active Today", "At Risk", "Top Performers"), daily submission matrices, heatmaps, 30-day trends, difficulty-split pie charts, and cross-classroom overviews.
- **Automated Refresh** — Background worker processes student profiles in chunks. Daily Vercel cron + 10-minute GitHub Actions pump keep data fresh. Rate-limited with lease-based concurrency.
- **Public Student Lookup** — Unauthenticated users can look up any student by roll number (PII masked).
- **Dark & Light Themes** — Dark-by-default with an optional light mode. Smooth view transitions and custom motion curves.
- **Almanac Mark** — The brand logo is the product's own submission heatmap: a 4×4 grid of days whose density climbs toward the bottom-right. Its animated variant fills along the diagonal and doubles as the full-page loading state. Inline SVG, theme-aware, legible at 16px.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [TanStack Start](https://tanstack.com/start/latest) (React 19) |
| Routing | [TanStack Router](https://tanstack.com/router) (file-based) |
| Data Fetching | [TanStack Query](https://tanstack.com/query) v5 |
| Styling | Tailwind CSS v4 + [shadcn/ui](https://ui.shadcn.com/) (New York style) |
| Charts | [Recharts](https://recharts.org/) v2 |
| Backend / DB | [Supabase](https://supabase.com/) (PostgreSQL, Auth, Storage, RLS) |
| Auth | Supabase Auth (email/password + Google OAuth) |
| Icons | [Lucide](https://lucide.dev/) |
| Forms | React Hook Form + Zod |
| Deployment | [Vercel](https://vercel.com/) (Nitro serverless) |
| Language | TypeScript 5.8 (strict) |
| Package Manager | npm / bun |

## Getting Started

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project (free tier works)
- [Vercel](https://vercel.com) account (for deployment)

### Setup

```bash
# Clone the repo
git clone <repo-url>
cd almanac

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Fill in SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET

# Run database migrations (via Supabase CLI)
supabase migration up --linked

# Start development server
npm run dev
```

The dev server starts at `http://localhost:3000`.

### Environment Variables

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase anon/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-only) |
| `CRON_SECRET` | Random secret for authenticating cron endpoints |

## Project Structure

```
src/
├── components/         # UI components (sidebar, heatmap, charts, shadcn primitives)
├── hooks/              # React hooks (auth, role, refresh job, mobile detection)
├── integrations/       # Supabase client and auth middleware
├── lib/                # Server logic (LeetCode scraper, refresh worker, RBAC, bulk import)
├── routes/             # File-based TanStack Router routes
│   ├── _authenticated/ # Pages behind auth wall
│   ├── api/            # API endpoints (cron, refresh pump)
│   └── ...
├── router.tsx          # Router + QueryClient setup
├── server.ts           # Server entry point
├── start.ts            # TanStack Start configuration
└── styles.css          # Global styles, themes, animations
```

## Architecture

- **LeetCode Scraper** (`src/lib/leetcode.server.ts`) — Public GraphQL API client with exponential backoff and rate limiting.
- **Refresh Worker** (`src/lib/refresh-worker.server.ts`) — Processes students in chunks with Postgres-level lease locking to prevent duplicate work.
- **Cron Pipeline** — Vercel cron (`30 18 * * *`) triggers daily refresh; GitHub Actions pump runs every 10 minutes to pick up remaining chunks.
- **RBAC** — Supabase RLS policies enforce row-level access; server middleware validates roles on every authenticated request.
- **PII Masking** — Public student lookups redact personal information behind a privacy layer.

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npm run format` | Format with Prettier |
| `npm run typecheck` | TypeScript type checking |
| `npm run gen-types` | Regenerate Supabase TypeScript types |

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request

## License

MIT

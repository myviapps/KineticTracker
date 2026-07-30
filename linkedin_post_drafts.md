# LinkedIn Post Drafts — Kinetic Tracker

---

## Draft 1 — The "Problem → Solution" Hook

---

**"Our placement officer was tracking 500+ students' LeetCode progress... in a Google Sheet."**

Rows broke. Formulas died. Nobody knew who actually solved a problem today vs. who just opened the app.

So I built **Kinetic Tracker** — a full-stack classroom analytics platform that auto-scrapes LeetCode profiles and turns raw data into actionable dashboards.

Here's what it does:

📊 **Leaderboards + Behavioral Buckets** — instantly see who's "Active Today", who's "At Risk", and who your "Top Performers" are.

🔁 **Automated Data Refresh** — a Vercel cron + GitHub Actions pipeline refreshes student profiles every 10 minutes. No manual work. Ever.

🎯 **Heatmaps, Streak Tracking, Difficulty Splits** — visualize 30-day trends, daily submission matrices, and Easy/Medium/Hard pie charts per student.

🔐 **Role-Based Access** — Admins, Placement Officers, and Faculty each see exactly what they need. Row-Level Security in Postgres. Zero data leaks.

🌐 **Public Student Lookup** — anyone can look up a student by roll number (PII auto-masked).

**The tech stack behind it:**

→ TanStack Start (React 19) + TanStack Router + TanStack Query v5
→ Tailwind CSS v4 + shadcn/ui
→ Supabase (PostgreSQL, Auth, RLS)
→ Recharts for data viz
→ TypeScript 5.8 (strict mode)
→ Vercel (Nitro serverless) for deployment

Built this end-to-end: scraper with exponential backoff, lease-based concurrency for the refresh worker, Postgres-level locking to prevent duplicate jobs, and a fully animated radar logo with SVG sweep arms.

The hardest part? Rate-limiting a scraper against LeetCode's undocumented throttle limits while keeping 500+ profiles fresh every day. 

If you're running a coding bootcamp, training program, or college placement cell — this is the tool you wish you had.

Happy to share more about the architecture. Drop a comment or DM. 👇

#FullStack #React #TypeScript #Supabase #LeetCode #EdTech #BuildInPublic #TanStack #WebDev

---

## Draft 2 — The "Flex the Stack" Hook

---

**React 19 + TanStack Start + Supabase + a LeetCode GraphQL scraper.**

That's the stack. Here's what I built with it. 👇

I call it **Kinetic Tracker** — a platform that answers one question every placement officer asks:

*"Are my students actually solving problems, or just logging in?"*

**What makes it different:**

1️⃣ **Real data, not self-reported logs.**
It scrapes LeetCode's public GraphQL API — solved counts, submission calendars, contest ratings, badges, language stats — all automated with exponential backoff and rate limiting.

2️⃣ **Behavioral intelligence, not just numbers.**
Students are auto-bucketed into "Active Today", "Consistent", "At Risk", "Top Performers". Faculty don't read spreadsheets — they read signals.

3️⃣ **Enterprise-grade access control in an EdTech app.**
Three roles (Admin → Placement Officer → Faculty) with Supabase RLS policies enforcing row-level security. The Placement Officer sees cross-classroom analytics. Faculty see only their assigned cohorts.

4️⃣ **A background worker that never sleeps.**
Daily Vercel cron triggers a refresh. GitHub Actions pumps run every 10 min to process remaining chunks. Postgres lease-locking prevents duplicate work.

5️⃣ **Bulk operations that actually work.**
CSV/Excel import for student onboarding. One file → classroom created, students imported, LeetCode profiles scraped. Done.

**The tech I'm most proud of in this project:**

• File-based routing with TanStack Router
• Server functions with TanStack Start
• Animated SVG radar logo (rotating sweep arm + proximity-triggered data pulses)
• Dark-first UI with Tailwind v4 + shadcn/ui New York theme
• Zod validation on every form + server boundary

This is what happens when you stop building todo apps and start building tools that solve real problems.

What's a "boring" problem in your industry that deserves a proper product?

#React19 #TanStack #Supabase #TypeScript #FullStackDev #BuildInPublic #EdTech #WebDevelopment

---

## Draft 3 — The "Controversial Opinion" Hook

---

**Unpopular opinion: Most students don't need more DSA resources.**

**They need someone watching.**

Here's what I mean:

I work with college placement cells. Every semester, they hand students a LeetCode link and say "practice daily."

3 weeks later:
→ 40% haven't solved a single problem
→ 30% solved 5 Easy questions and stopped
→ 20% are inconsistent
→ 10% are crushing it

But no one knows this until the mock interviews start — and by then, it's too late.

So I built **Kinetic Tracker**.

It's a full-stack platform that connects to LeetCode's public API and gives educators a live pulse on every student's coding activity.

**Not motivation. Visibility.**

🔍 Daily submission heatmaps — who solved what, and when
📈 30-day trend lines — is this student improving or flatlining?
🏷️ Smart behavioral tags — "At Risk", "Active Today", "Top Performer"
📊 Difficulty split analysis — are they only doing Easy problems?
🏆 Leaderboards + contest rating tracking
🔐 Role-based dashboards for Admin, Placement Officers, Faculty

**Under the hood:**

The app is built on **TanStack Start** (React 19 meta-framework) with **TanStack Router** for file-based routing and **TanStack Query v5** for server-state management.

Backend is **Supabase** — PostgreSQL with Row-Level Security, Auth (email + Google OAuth), and service-role keys for server operations.

The LeetCode scraper hits their public GraphQL endpoint with custom retry logic, exponential backoff, and a lease-based refresh worker that processes students in chunks to stay under rate limits.

Frontend is **Tailwind CSS v4** + **shadcn/ui** with **Recharts** for all the data viz. Dark mode by default. Smooth animations everywhere. Deployed on **Vercel** with Nitro serverless.

The entire codebase is **TypeScript 5.8 in strict mode**. Every form validated with **Zod**. Every server function type-safe.

The result? Placement officers went from "I hope students are practicing" to "I know exactly who isn't — and I intervened this morning."

**That's the power of building tools for real workflows.**

Would love to connect with others building in the EdTech / developer tooling space. 🤝

#EdTech #LeetCode #FullStack #React #Supabase #TypeScript #TanStack #PlacementPrep #BuildInPublic #SoftwareEngineering

---

> **Recommended Posting Notes:**
> - Add 2–3 screenshots/video demo of the dashboard, heatmap, and leaderboard for maximum engagement
> - Tag relevant people (your faculty, placement officer) for social proof
> - Post between 8–10 AM IST on Tuesday/Wednesday for best LinkedIn reach
> - Reply to every comment within the first hour to boost the algorithm

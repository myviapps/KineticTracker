# Marketing Landing Page for Almanac

## Context

`/` is currently a bare utility page ([src/routes/index.tsx](src/routes/index.tsx)): a 14px-tall header, an H1, and a big search input. It works, but it tells a first-time visitor nothing about what Almanac does — no features, no product visuals, no reason to sign in.

We're turning `/` into a real marketing landing page in the style of 21st.dev's free landing components, while **keeping the search** — it moves into the hero (same behavior) and also gets its own dedicated `/search` route.

**User decisions already made:**
1. `/` = marketing page with live search embedded in the hero; new `/search` route holds today's focused search page.
2. **"Bold, but on-palette"** — animated grid backdrop, amber glow, bento grid, marquee — but strictly within the existing amber/oklch tokens. No rainbow SaaS gradients. The app interior stays untouched.
3. Add the `motion` package (framer-motion v12).
4. All four section groups: hero + live stats, bento features, product showcase, roles/FAQ/CTA/footer.

**Verified constraints (these are the ones that bite):**
- Tailwind **v4 CSS-first — there is no `tailwind.config.ts`**. All theming is in [src/styles.css](src/styles.css) via `@theme`. Creating a config file would be silently ignored (`@import "tailwindcss" source(none)`).
- **Dark is the default; light is opt-in via `.light` on `<html>`** — inverted from stock shadcn. `dark:` compiles but applies backwards. Semantic tokens only.
- **Anon cannot read aggregates.** `supabase/migrations/20260718000001_role_based_access.sql:119-123` explicitly `revoke select on public.{students,classrooms,student_stats} from anon`. Live stats need a service-role server function.
- `src/routeTree.gen.ts` is auto-generated **and committed**.
- Fonts load Inter 400–800 only. `font-black` (900) will synthesize.

---

## New files

### `src/lib/site.ts`
```ts
/** Absolute origin — og:image and canonical must be absolute; several social
    scrapers reject relative URLs. VERCEL_URL is per-deployment, so not used. */
export const SITE_URL = (import.meta.env.VITE_SITE_URL ?? "http://localhost:5173").replace(/\/$/, "");
```
Add `VITE_SITE_URL` to [.env.example](.env.example).

### `src/lib/landing.functions.ts` — public aggregate stats

`createServerFn({ method: "GET" })`, **no validator, no middleware** — deliberately public, exactly like `searchStudents` in [src/lib/search.functions.ts](src/lib/search.functions.ts).

```ts
export type LandingStats = {
  students: number | null; classrooms: number | null; colleges: number | null;
  problemsSolved: number | null; platforms: number | null; generatedAt: string;
};
```

**The service-role import MUST be lazy and inside the handler** — byte-for-byte matching [src/lib/search.functions.ts:39](src/lib/search.functions.ts#L39):
```ts
const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
```
A top-level import ships the service-role key to the browser, because this file is imported by a route component. This is the single highest-severity mistake available in this task — see the audit note at [src/lib/authz.ts:44-53](src/lib/authz.ts#L44-L53).

Queries, each failure-isolated with `Promise.allSettled` (not `Promise.all`):
- `supabaseAdmin.rpc("distinct_student_count")` — **exists already**, granted to `service_role` at `supabase/migrations/20260731000001_classroom_students.sql:656`. **Omit the argument entirely**; [src/lib/classrooms.functions.ts:70-74](src/lib/classrooms.functions.ts#L70-L74) documents that the regenerated types reject an explicit `null`.
- `.from("classrooms" | "colleges" | "platforms").select("*", { count: "exact", head: true })`
- `.from("student_stats").select("total_solved").range(0, 49_999)` — PostgREST has no `sum()`; sum in the handler. The `.range()` mirrors `MAX_ROWS` in [src/lib/overview.functions.ts](src/lib/overview.functions.ts) so the default `db-max-rows` can't silently truncate.

Module-level 5-minute cache (`let cache: { at, value } | null`); **only cache a result that has data**, so a total outage isn't pinned for 5 minutes. The handler must **never throw** — every field degrades to `null` independently.

**Scalars only.** No names, no rolls, no "top performer" — that would undo the masking work in `src/lib/mask.ts`.

> **Do not** query the `*_public` views from the browser instead. They bypass RLS (non-`security_invoker`), so it would work — but it re-opens the exact student-enumeration primitive that the doc comment at [src/lib/search.functions.ts:6-21](src/lib/search.functions.ts#L6-L21) says anon search was narrowed to kill, and summing `total_solved` client-side means shipping the whole cohort's score sheet to any visitor.

### `src/hooks/use-student-search.ts` — extracted once, used twice

Lifts the debounce + `minLength` + auth state out of `index.tsx` so the hero and `/search` share one implementation and one cache entry.

**Preserve the contract exactly:** `const minLength = signedIn ? 2 : 3` and `queryKey: ["search", debounced, signedIn]` — keeping the key byte-identical means typing in the hero then clicking to `/search` hits a warm cache.

Two upgrades while extracting:
- Replace the raw `useEffect(() => getCurrentUserClient().then(...))` with **`useRole()`** ([src/hooks/use-role.ts](src/hooks/use-role.ts)) — it already wraps the same call in a shared 5-min query and is cleared on account switch. With a header *and* a hero both needing auth state, the raw effect would fire twice. Keep the tri-state: `isLoading ? null : !!user`.
- Add the client-side character guard `/^[a-zA-Z0-9\s.\-_@]*$/` from [src/components/student-search.tsx:39](src/components/student-search.tsx#L39) — the hero currently lacks it, so typing `%` yields a silent failed request.

### `src/routes/search.tsx` — today's page, moved

Copy [src/routes/index.tsx](src/routes/index.tsx) wholesale, then: `createFileRoute("/search")`, rename to `SearchPage`, new `head()` meta (`"Find a student — Almanac"`), wrap the header logo in `<Link to="/">`, add an `ArrowLeft` back-link matching the idiom in [src/routes/students.$roll.tsx:69-76](src/routes/students.$roll.tsx#L69-L76), and refactor onto `useStudentSearch()`. **Keep the autofocus** here — it's correct on a dedicated search page. Drop the now-redundant "Search" button that focuses the input.

### `src/components/landing/` — one file per section

| File | Contents |
|---|---|
| `landing-content.ts` | Pure data, no JSX: `FEATURES[]` (title, blurb, lucide icon, **literal** bento span class), `FAQS[]`, `ROLES[]`, `PLATFORMS[]` (real names from `supabase/migrations/20260808000010_new_platform_adapters.sql`). Copy edits become a one-file diff. |
| `landing-header.tsx` | Sticky nav — `AlmanacLogo size={28}`, anchor links, `ThemeToggle`, `/search` link, auth-aware CTA via `useRole()`. `sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur` (the pattern already used on 7 sticky headers). |
| `grid-backdrop.tsx` | `aria-hidden` stack: drifting grid + amber radial glow + optional pointer spotlight. `pointer-events-none`. |
| `hero.tsx` | Eyebrow badge, H1, subhead, `<HeroSearch/>`, CTAs, `<StatsStrip/>`. |
| `hero-search.tsx` | Live search on `useStudentSearch()`. **No autofocus** — autofocusing a marketing page scroll-jumps on mobile. |
| `stats-strip.tsx` | 4 tiles from `getLandingStats()`. `useAnimatedNumber` for count-up, `Skeleton` while loading, `—` on failure. |
| `bento-features.tsx` + `bento-card.tsx` | Grid container + card primitive with hover glow. |
| `showcase.tsx` + `showcase-heatmap.tsx` + `showcase-leaderboard.tsx` | App-chrome frame around a mock heatmap and leaderboard. |
| `platform-marquee.tsx` | CSS-only infinite strip, children duplicated once, edge-masked, pause on hover. |
| `roles.tsx`, `faq.tsx`, `final-cta.tsx`, `landing-footer.tsx` | Role cards, shadcn `Accordion`, CTA band, footer. |
| `reveal.tsx` | `<Reveal>` / `<RevealGroup>`. **The only file that imports `motion`.** |

`src/routes/index.tsx` becomes ~70 lines of composition wrapped in one `<MotionConfig reducedMotion="user">`.

---

## Modified files

- **[src/styles.css](src/styles.css)** — tokens, keyframes, classes (below).
- **[src/components/heatmap.tsx:92](src/components/heatmap.tsx#L92)** — `function cellClass` → `export function cellClass`. One line, so the showcase mock stays in lockstep with the real product surface instead of copy-pasting five intensity classes that go stale.
- **package.json** — `"motion": "^12"`. Install with **npm** (`vercel.json` sets `installCommand: npm install`); commit `package-lock.json`.
- **src/routeTree.gen.ts** — regenerated, committed.
- **public/og.png** — new 1200×630 asset (none exists today).

---

## The "bold but on-palette" CSS

**Rule:** anything using `color-mix()`, `oklch()`, multi-stop gradients or `mask-image` goes in a **named class** in `styles.css`. Layout stays in utilities. Tailwind v4 arbitrary values need every space and paren escaped, and `lightningcss` ([vite.config.ts:29](vite.config.ts#L29)) will mangle a bad one.

**Tokens** — append inside the *existing* `@theme` block ([src/styles.css:15-55](src/styles.css#L15-L55)); Tailwind v4's `--animate-*` namespace exposes these as `animate-marquee` etc.:
```css
  --animate-marquee:    marquee-x  40s linear infinite;
  --animate-grid-drift: grid-drift 22s linear infinite;
  --animate-glow-pulse: glow-pulse  7s var(--ease-swap) infinite;
```

**Glow strength as a theme token** — `--landing-glow: 0.22` in `:root`, `0.10` in `.light`. A 22%-alpha amber wash reads as atmosphere on the dark background and as mud on the light one. One token, two values, **no `dark:` variant anywhere**.

**Grid backdrop** — two `linear-gradient` hairlines drawn from `var(--border)` (so it inverts with the theme for free), `background-size: 56px 56px`, `mask-image: radial-gradient(ellipse 80% 65% at 50% 0%, #000 30%, transparent)` so it's atmosphere at the top and gone by the fold. `@keyframes grid-drift { to { background-position: 56px 56px, 56px 56px; } }` — drifting exactly one tile makes the loop seamless.

**Amber glow** — `.landing-glow { background: radial-gradient(ellipse 55% 45% at 50% 0%, color-mix(in oklab, var(--primary) calc(var(--landing-glow) * 100%), transparent), transparent 72%); }`. The final CTA reuses the same class with a local `style={{ "--landing-glow": 0.3 }}` override.

**Bento grid** — pure utilities, zero new CSS. Container: `grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6 lg:auto-rows-[13rem]`. Daily matrix gets `lg:col-span-4 lg:row-span-2`; the rest split 2/3-wide.
> **Critical:** span classes must be **literal strings** in `landing-content.ts`. `` `lg:col-span-${n}` `` compiles to nothing — the v4 scanner reads source text, not runtime values.

**Marquee** — `@keyframes marquee-x { to { transform: translateX(-50%) } }`, track holds its children twice, `w-max` (not `w-[200%]`) so `-50%` is always the exact seam. `.marquee-mask` for the edge fade, `:hover { animation-play-state: paused }`.

**Reduced motion** — append inside the **existing** `@media (prefers-reduced-motion: reduce)` block at [src/styles.css:328](src/styles.css#L328), don't open a second one:
```css
  /* The global 1ms rule would park an infinite marquee at its end state while
     still burning a composited layer. Stop these outright. */
  .marquee-track { animation: none !important; transform: none !important; }
  .landing-grid, .landing-glow { animation: none !important; }
```

---

## Motion integration

Import surface: `import { motion, MotionConfig, useReducedMotion } from "motion/react"` — never `"framer-motion"`.

Easing: use `[0.16, 1, 0.3, 1]`, the numeric form of `--ease-glide` ([src/styles.css:17](src/styles.css#L17)), so JS and CSS motion feel like one system.

**The hero uses NO motion.** It uses the existing CSS pattern from [src/routes/index.tsx:160-163](src/routes/index.tsx#L160-L163) — `animate-in fade-in slide-in-from-bottom-1 fill-mode-backwards` + indexed `animationDelay`. Zero JS, paints on the first frame, no hydration gap on the LCP element.

`motion` is used for: stats strip, bento stagger (`staggerChildren: 0.06`), showcase heatmap cascade (`delay: (row+col) * 0.012`, echoing the `.almanac-day` diagonal), leaderboard bar widths, and the roles/FAQ/CTA reveals. The marquee stays CSS.

**Three SSR pitfalls — hydration mismatch is *not* one of them** (`initial` renders identically on both sides):

1. **`whileInView` content is `opacity: 0` until JS + IntersectionObserver land.** Never wrap the H1, subhead, primary CTA, or search input in `<Reveal>`. Everything wrapped is below the fold and still in the DOM for crawlers. The no-JS test in Verification catches violations.
2. **`useReducedMotion()` returns `null` on the server and first client render**, then flips — branching `initial` on it flashes the exact users who must not be flashed. **Fix: one `<MotionConfig reducedMotion="user">` around the whole tree.** No per-component branching. Use the hook only for hard bails (pointer spotlight, heatmap cascade).
3. **The CSS reduced-motion block does nothing to `motion`**, which drives WAAPI/JS, not CSS animations — and `MotionConfig` does nothing to CSS. **Both are required.** Write this as a comment; it's exactly the kind of thing that gets "fixed" wrongly later.

If the Nitro SSR build fails to resolve `motion/react`, add `ssr: { noExternal: ["motion"] }` to `vite.config.ts`. Only `npm run build` surfaces this — `vite dev` resolves differently.

---

## Reuse (verified to exist)

Reuse verbatim: `cn`, `AlmanacLogo`, `ThemeToggle`, `Button` (`asChild` + `<Link>`), `Accordion`, `Skeleton`, `Separator`, `Badge`, **`SectionTitle`** ([src/components/stat-card.tsx:72](src/components/stat-card.tsx#L72) — this *is* the section-label idiom, don't write a landing-specific one), and **`useAnimatedNumber`** ([src/hooks/use-animated-number.ts](src/hooks/use-animated-number.ts) — already reduced-motion-aware; **do not write a count-up**).

**Don't reuse these four, for concrete reasons:**
- **`Heatmap`** — builds 53×7 = 371 nodes each with a `title` attribute. Dead weight on a marketing LCP. Write a ~26×7 deterministic grid, import `cellClass` for fidelity.
- **`LeaderboardBars`** — every row is a `<Link to="/students/$roll">`; with fabricated names those are dead links to "Student not found". Copy the bar markup into static `<div>` rows.
- **`StudentSearch`** — it's the staff header combobox with `minLength` hardcoded to 2 and no anon branch. Dropping it in would silently delete the `signedIn ? 2 : 3` guard, re-opening the enumeration path.
- **`StatCard`** — tuned for the dense instrument panel (`min-h-[7.25rem]`, `text-2xl`). Marketing stats want `text-4xl sm:text-5xl` and air.

---

## SEO

Add to `/`'s `head()`: title, longer description, `og:title`/`og:description`/`og:url`/`og:image` (+ width/height/alt), `twitter:image`, and a `canonical` link — all built from `SITE_URL`.

**Do not redefine `og:type` or `twitter:card`** — [src/routes/__root.tsx:93-94](src/routes/__root.tsx#L93-L94) already sets both and route meta merges with root's. Keep the route set purely additive.

`public/og.png` must be **PNG, not SVG** (X/LinkedIn/Slack don't render SVG og:images). Compose on `oklch(0.14 0.005 260)` with the amber grid mark and "ALMANAC" in JetBrains Mono at `0.18em` tracking. **Until the asset exists, omit the `og:image` meta entirely** — a missing image degrades to a text card, a broken one shows a grey box.

---

## Build order

1. Branch — the tree is very dirty (~100 modified files).
2. `npm install motion`.
3. `src/lib/site.ts` + `src/lib/landing.functions.ts` + `.env.example`. Verify the service-role import is lazy.
4. Create `src/routes/search.tsx` → run `npm run dev` once to regenerate → commit **with** `routeTree.gen.ts`. **Only then** add `<Link to="/search">` anywhere — `to` is typed against the generated union, so links added earlier fail `npm run typecheck`.
5. `src/hooks/use-student-search.ts`; refactor `search.tsx` onto it.
6. `src/styles.css` — commit alone so the CSS diff is reviewable.
7. Export `cellClass`.
8. `src/components/landing/*` bottom-up: `landing-content.ts` → `reveal.tsx` → `bento-card.tsx` → sections.
9. Rewrite `src/routes/index.tsx` as composition + `head()`.
10. `public/og.png`, then wire the meta.

---

## Verification

**Commands:** `npm run dev` (port 5173) · `npm run typecheck` · `npm run lint` · `npm run test` · `npm run build` (the only thing that exercises the Nitro/Vercel SSR path).

**Anonymous** — private window on `/`: subhead reads "Enter a student's full roll number"; typing 2 chars fires **no network request** and shows the guidance copy; a complete roll returns exactly one masked result with **no `ExternalLink` icon**. **The security regression test:** a 3-char *prefix* of a known roll must return **zero** results, not a partial list.

**Signed in:** subhead switches, 2 chars suffices, results unmasked and classroom-scoped, header CTA becomes "Dashboard". Sign out in another tab → the header flips back within one render (`use-auth-cache-sync`).

**Stats:** numbers count up; `students` must match the classrooms page's `totalStudents` (same RPC). **Failure path — comment out `SUPABASE_SERVICE_ROLE_KEY` and restart: the page must render completely with `—` in the tiles.** No error boundary, no blank section.

**Theming:** toggle → `<html class="light">`. Glow reads as warmth not mud; text ≥ 4.5:1. **`git diff | grep 'dark:'` over the new files must be empty.** Hard-reload in light mode → no dark flash.

**Motion:** DevTools → Rendering → emulate `prefers-reduced-motion: reduce`, hard-reload. Marquee fully stopped (not just fast), grid/glow static, reveals resolved, stat figures at final values, **nothing stuck invisible**. Then **disable JavaScript and reload `/`** — H1, subhead, every section heading and body paragraph, and the footer must all be visible. This is the one test that catches accidentally wrapping critical content in `whileInView`.

**Responsive:** 360 / 414 / 768 / 1024 / 1440px. Bento collapses 6→2→1 with no orphan card; **no horizontal scrollbar** (the marquee is the likely culprit — check `overflow-hidden`); H1 wraps to ≤3 lines at 360px.

**Routes:** `/search` renders the old experience and autofocuses; back-link returns to `/`; a direct hit on `/search` in a fresh tab works.

**Post-build — the important one:**
```bash
grep -r "SERVICE_ROLE\|supabaseAdmin" .vercel/output/static/   # must find NOTHING
grep -o "marquee-x\|grid-drift\|glow-pulse" .vercel/output/static/assets/*.css | sort -u
```
The first re-validates the audit claim recorded at [src/lib/authz.ts:44-48](src/lib/authz.ts#L44-L48) after adding `landing.functions.ts`. Then Lighthouse mobile on `/`: LCP should be the **H1 text**, CLS should be **0** (which is the assertion that the reserved stat-tile heights actually work).

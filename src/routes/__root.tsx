import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { type ReactNode } from "react";
import { AlmanacLogo } from "@/components/almanac-logo";

import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import { useTheme } from "@/components/theme-toggle";
import { useAuthCacheSync } from "@/hooks/use-auth-cache-sync";

/*
  Theme AND reading preferences, stamped on <html> before the first paint.

  Inline and synchronous for the same reason the theme always was: React cannot
  read localStorage during SSR, so anything applied in an effect lands one frame
  late — a visible flash of the wrong palette, and now also of the wrong text
  size, on every single page load.

  The scale table is duplicated from lib/appearance.ts rather than imported.
  This string is injected raw into the document head and runs before any bundle
  has loaded, so it cannot import anything. Four numbers is a cheap duplication;
  a missing one just means the default size for a frame.
*/
const APPEARANCE_INIT = `
(function(){try{var d=document.documentElement;
var t=localStorage.getItem('kinetic-theme');
if(t==='light'){d.classList.remove('dark');d.classList.add('light');}
else{d.classList.remove('light');d.classList.add('dark');}
var f=localStorage.getItem('almanac-font');
if(f==='system'||f==='hyperlegible'){d.setAttribute('data-font',f);}
var m={sm:0.9,md:1,lg:1.1,xl:1.25}[localStorage.getItem('almanac-font-scale')];
if(m){d.style.setProperty('--app-font-scale',String(m));}}catch(e){}})();
`;

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4">
      <div className="flex flex-col items-center gap-3">
        <AlmanacLogo animated size={48} showText={false} />
      </div>
      <div className="max-w-md text-center">
        <h1 className="font-mono text-7xl font-bold text-primary">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">Nothing matches this URL.</p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110"
          >
            Try again
          </button>
          <a
            href="/"
            className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Almanac" },
      {
        name: "description",
        content:
          "Track LeetCode progress across classrooms. Day-wise reports, heatmaps, and full student profiles.",
      },
      { property: "og:title", content: "Almanac" },
      {
        property: "og:description",
        content: "Day-wise cohort reports and rich student profiles for LeetCode.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        // Archivo is requested with its `wdth` axis (75..125), not just weights:
        // the landing display type is set WIDE, and without the axis the browser
        // gets the default 100 width and synthesises nothing — the headlines
        // would silently render at normal width and the whole type direction
        // would be invisible. Weight is capped at 800 (Archivo's usable top) and
        // the subset stays minimal — one extra family, three axes.
        // Atkinson Hyperlegible is listed but not downloaded unless someone
        // selects it — the stylesheet declares the @font-face, and browsers
        // fetch the file only when a rule actually applies the family.
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&family=Archivo:wdth,wght@75..125,500..800&family=Atkinson+Hyperlegible:wght@400;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    /*
      suppressHydrationWarning is required here, not a workaround.

      The server has no way to know the visitor's theme — it lives in
      localStorage — so it always renders `dark`. APPEARANCE_INIT then runs inline in
      <head>, BEFORE first paint, and swaps the class to `light` when that is the
      saved preference. That ordering is the whole point: it is what stops a
      light-theme user seeing a dark flash on every navigation.

      React hydrates afterwards, finds `light` in the DOM where it rendered
      `dark`, and reports a mismatch. The mismatch is deliberate and correct;
      this attribute tells React so. It suppresses only THIS element's own
      attributes — one level deep — so a genuine mismatch anywhere inside the
      tree is still reported.
    */
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_INIT }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const [theme] = useTheme();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthCacheSync />
      <div className="min-h-screen w-full bg-background text-foreground">
        <Outlet />
      </div>
      <Toaster position="top-right" theme={theme} />
    </QueryClientProvider>
  );
}

/**
 * Must live INSIDE QueryClientProvider (it needs the client), and renders nothing.
 * See use-auth-cache-sync.ts for why account switching needed this at all.
 */
function AuthCacheSync() {
  useAuthCacheSync();
  return null;
}

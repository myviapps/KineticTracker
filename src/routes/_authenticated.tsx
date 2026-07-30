import { createFileRoute, Link, Outlet, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type CSSProperties } from "react";
import { LayoutDashboard, MoreVertical } from "lucide-react";
import { AlmanacLogo } from "@/components/almanac-logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { StudentSearch } from "@/components/student-search";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useRefreshJobPump } from "@/hooks/use-refresh-job";
import { RefreshProgressStrip } from "@/components/refresh-progress-strip";
import { AppShellSkeleton } from "@/components/skeletons";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    // Use client-side Supabase (localStorage session) — don't call the server
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");
  },
  errorComponent: ({ error }) => {
    if (error.message === "Not authenticated") {
      return <RedirectToAuth />;
    }
    return <div className="p-8 text-sm text-destructive">{error.message}</div>;
  },
  component: AuthenticatedLayout,
});

function RedirectToAuth() {
  const router = useRouter();
  useEffect(() => {
    router.navigate({ to: "/auth" });
  }, [router]);
  return null;
}

function AuthenticatedLayout() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [pinned, setPinned] = useState(true);
  // Mounted here (and only here) so the job keeps advancing across route changes.
  useRefreshJobPump();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) router.navigate({ to: "/auth" });
      setChecking(false);
    });
  }, [router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1280px)");
    const apply = () => setPinned(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Was `return null`, so every full page load flashed a bare background before
  // any chrome appeared.
  if (checking) return <AppShellSkeleton />;

  return (
    /*
      The nav bar owns the shell: it spans the full viewport width and the
      sidebar starts underneath it (see `--app-header-h` below and the offset
      passed to <Sidebar> in app-sidebar.tsx). Brand lives here, not in the
      sidebar, so it stays visible when the sidebar collapses to icons.
    */
    <SidebarProvider
      open={pinned}
      onOpenChange={setPinned}
      className="flex-col"
      style={{ "--app-header-h": "3rem" } as CSSProperties}
    >
      <header className="sticky top-0 z-40 flex h-(--app-header-h) w-full shrink-0 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur sm:gap-3 sm:px-4">
        {/*
          Mobile only. The sidebar's own toggle lives inside the sidebar, but on
          mobile the sidebar is an off-canvas sheet — a control inside it can't
          open it, so the hamburger has to live out here.
        */}
        <SidebarTrigger className="shrink-0 md:hidden" />

        <Link to="/dashboard" className="shrink-0" title="Almanac">
          <AlmanacLogo size={22} className="[&_span]:hidden sm:[&_span]:inline" />
        </Link>

        <StudentSearch className="ml-auto w-full min-w-0 max-w-[180px] sm:max-w-[220px] lg:max-w-[320px]" />

        {/* Inline actions once there's room for them. */}
        <Button asChild variant="ghost" size="sm" className="hidden shrink-0 px-2 sm:inline-flex">
          <Link to="/dashboard" title="Dashboard">
            <LayoutDashboard className="size-4" />
            <span className="ml-1 hidden lg:inline">Dashboard</span>
          </Link>
        </Button>
        <div className="hidden sm:block">
          <ThemeToggle />
        </div>

        {/*
          Below `sm` those same actions were being squeezed to slivers next to the
          search field. They collapse into one menu instead.
        */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="shrink-0 sm:hidden" aria-label="More">
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem asChild>
              <Link to="/dashboard">
                <LayoutDashboard className="size-4" />
                Dashboard
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="p-0">
              <ThemeToggle variant="menu" />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="flex w-full min-w-0 flex-1">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <RefreshProgressStrip />
          {/*
            view-transition-name scopes the cross-fade to the content that actually
            changes. The keyframes in styles.css used to target ::view-transition-*(root),
            which faded the sidebar and header on every navigation too — visible
            flicker on static chrome, on the app's most frequent action (switching
            classrooms).
          */}
          <main className="min-w-0 flex-1 [view-transition-name:main-content]">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

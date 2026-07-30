import { createFileRoute, Link, Outlet, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LayoutDashboard } from "lucide-react";
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
    <SidebarProvider open={pinned} onOpenChange={setPinned}>
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur sm:gap-3 sm:px-4">
          <SidebarTrigger />
          {/* Hidden below md so the search field gets the room on a phone. */}
          <div className="hidden truncate font-mono text-[11px] uppercase tracking-widest text-muted-foreground md:block">
            Kinetic Tracker
          </div>
          <StudentSearch className="ml-auto w-full max-w-[220px] sm:max-w-[280px]" />
          <Button asChild variant="ghost" size="sm" className="shrink-0 px-2">
            <Link to="/dashboard" title="Dashboard">
              <LayoutDashboard className="size-4" />
              <span className="ml-1 hidden lg:inline">Dashboard</span>
            </Link>
          </Button>
          <ThemeToggle />
        </header>
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
    </SidebarProvider>
  );
}

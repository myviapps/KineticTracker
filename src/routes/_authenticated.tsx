import { createFileRoute, Outlet, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { supabase } from "@/integrations/supabase/client";
import { useRefreshJob } from "@/hooks/use-refresh-job";
import { RefreshProgressStrip } from "@/components/refresh-progress-strip";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    // Use client-side Supabase (localStorage session) — don't call the server
    const { data: { user } } = await supabase.auth.getUser();
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
  useRefreshJob();

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

  if (checking) return null;

  return (
    <SidebarProvider open={pinned} onOpenChange={setPinned}>
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-border bg-background/80 px-3 backdrop-blur sm:px-4">
          <SidebarTrigger />
          <div className="truncate font-mono text-[10px] uppercase tracking-widest text-muted-foreground sm:text-[11px]">
            Kinetic Tracker
          </div>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
          </div>
        </header>
        <RefreshProgressStrip />
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </SidebarProvider>
  );
}

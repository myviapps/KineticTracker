import { createFileRoute, Outlet, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getCurrentUserClient } from "@/lib/auth.functions";

export const Route = createFileRoute("/_authenticated/_admin")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { user, role } = await getCurrentUserClient();
    if (!user || role !== "admin") {
      throw new Error("Forbidden");
    }
  },
  errorComponent: ({ error }) => {
    if (error.message === "Forbidden") {
      return <RedirectToDashboard />;
    }
    return <div className="p-8 text-sm text-destructive">{error.message}</div>;
  },
  component: AdminLayout,
});

function RedirectToDashboard() {
  const router = useRouter();
  useEffect(() => {
    router.navigate({ to: "/dashboard" });
  }, [router]);
  return null;
}

function AdminLayout() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    getCurrentUserClient().then(({ user, role }) => {
      if (!user || role !== "admin") router.navigate({ to: "/dashboard" });
      setChecking(false);
    });
  }, [router]);

  if (checking) return null;
  return <Outlet />;
}

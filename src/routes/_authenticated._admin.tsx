import { createFileRoute, Outlet, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { getCurrentUserClient } from "@/lib/auth.functions";
import { useRole } from "@/hooks/use-role";
import { SkeletonPageHeader, SkeletonRows } from "@/components/skeletons";

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
  // Was a second bespoke getCurrentUserClient() + useState pair, duplicating the
  // check in beforeLoad above and firing its own auth round-trip on every
  // navigation. useRole shares one cached query with the rest of the app.
  const { role, isLoading } = useRole();

  useEffect(() => {
    if (!isLoading && role !== "admin") {
      router.navigate({ to: "/dashboard" });
    }
  }, [isLoading, role, router]);

  // Was `return null`, which stacked a second blank frame on top of the parent
  // layout's own blank frame for every admin page load.
  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <SkeletonPageHeader />
        <SkeletonRows rows={3} />
      </div>
    );
  }

  if (role !== "admin") return null;

  return <Outlet />;
}

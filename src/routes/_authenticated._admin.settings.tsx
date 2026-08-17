import { createFileRoute } from "@tanstack/react-router";
import { Settings2, Chrome, Check, X } from "lucide-react";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { getSiteSettings, updateGoogleAuth } from "@/lib/settings.functions";
import { AnimatedLoader } from "@/components/animated-loader";

export const Route = createFileRoute("/_authenticated/_admin/settings")({
  head: () => ({ meta: [{ title: "Settings — Almanac" }] }),
  loader: async ({ context: { queryClient } }) => {
    queryClient.ensureQueryData({ queryKey: ["settings"], queryFn: () => getSiteSettings() });
  },
  component: SettingsPage,
  pendingComponent: () => <AnimatedLoader text="Loading settings…" />,
});

function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useSuspenseQuery({
    queryKey: ["settings"],
    queryFn: () => getSiteSettings(),
  });

  const toggleGoogle = useMutation({
    mutationFn: async (enabled: boolean) => {
      await updateGoogleAuth({ data: enabled });
    },
    onMutate: async (enabled) => {
      await queryClient.cancelQueries({ queryKey: ["settings"] });
      queryClient.setQueryData(["settings"], { google_auth_enabled: enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Settings updated successfully");
    },
    onError: (_e) => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.error("Failed to update settings");
    },
  });

  const googleEnabled = settings?.google_auth_enabled ?? true;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-8">
        <h1 className="font-mono text-xs uppercase tracking-[0.25em] text-primary">
          Almanac / Admin
        </h1>
        <h2 className="mt-2 text-3xl font-bold tracking-tight">Settings</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Configure platform-wide preferences for Almanac.
        </p>
      </div>

      {/* Authentication Settings */}
      <section className="mb-8">
        <h3 className="mb-4 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          <Settings2 className="size-3" /> Authentication
        </h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-border bg-surface p-5">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-md border border-border bg-background">
                <Chrome className="size-5 text-muted-foreground" />
              </div>
              <div>
                <div id="google-auth-label" className="text-sm font-semibold">
                  Google Sign-In
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Show "Sign in with Google" button on the login page.
                  <br />
                  <span className="font-mono text-[10px]">
                    Note: Requires Google OAuth to be configured in your Supabase project.
                  </span>
                </div>
              </div>
            </div>
            <button
              id="google-auth-toggle"
              type="button"
              role="switch"
              disabled={toggleGoogle.isPending}
              aria-checked={googleEnabled}
              // The switch has no text of its own, so without this a screen
              // reader announced only "switch, checked" — no indication of WHAT
              // was being toggled. Points at the heading beside it.
              aria-labelledby="google-auth-label"
              onClick={() => toggleGoogle.mutate(!googleEnabled)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 ${
                googleEnabled ? "bg-primary" : "bg-muted"
              }`}
            >
              <span
                className={`pointer-events-none inline-block size-5 rounded-full bg-white shadow-lg ring-0 transition-transform duration-200 ${
                  googleEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* Status badge */}
          <div
            className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-mono ${
              googleEnabled
                ? "border border-easy/30 bg-easy/5 text-easy"
                : "border border-border bg-background text-muted-foreground"
            }`}
          >
            {googleEnabled ? (
              <>
                <Check className="size-3" /> Google Sign-In is <strong>enabled</strong> — visible on
                login page
              </>
            ) : (
              <>
                <X className="size-3" /> Google Sign-In is <strong>disabled</strong> — hidden from
                login page
              </>
            )}
          </div>
        </div>
      </section>

      {/* Info box */}
      <div className="rounded-lg border border-border bg-surface/50 p-4 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground">About these settings</p>
        <p className="mt-1">
          Settings are stored globally in the database. They apply to all users and devices
          immediately.
        </p>
      </div>
    </div>
  );
}

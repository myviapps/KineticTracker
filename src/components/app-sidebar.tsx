import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  FileSpreadsheet,
  Layers,
  Building2,
  Upload,
  UserCog,
  LayoutDashboard,
  LogOut,
  Settings2,
  Key,
  History,
  PanelLeftClose,
  PanelLeftOpen,
  Trophy,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  SidebarMenuSkeleton,
  useSidebar,
} from "@/components/ui/sidebar";
import { listClassrooms } from "@/lib/classrooms.functions";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/use-role";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

export function AppSidebar() {
  const { state, toggleSidebar, isMobile, setOpenMobile, setOpen } = useSidebar();

  /*
    `state` tracks the DESKTOP rail only. On mobile the sidebar is a full-width
    sheet, but `state` is "collapsed" there for any viewport under 1280px (see
    the media query in _authenticated.tsx) — so every `{!collapsed && <span>}`
    label was being stripped and the sheet rendered as a column of unlabelled
    icons with no visible text. Mobile is never the icon rail.
  */
  const collapsed = !isMobile && state === "collapsed";
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const currentPath = useRouterState({ select: (r) => r.location.pathname });
  const router = useRouter();
  const qc = useQueryClient();

  const changePwM = useMutation({
    mutationFn: async () => {
      if (newPassword !== confirmPassword) throw new Error("Passwords do not match");
      if (newPassword.length < 8) throw new Error("Password must be at least 8 characters");
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Password updated successfully");
      setIsChangingPassword(false);
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (e) => toast.error(String(e)),
  });

  const { role, isAdmin, isFaculty, isPlacementOfficer: isPO, isLoading: roleLoading } = useRole();

  // `isPending` rather than the `= []` default: the sidebar showed "No classrooms
  // yet" during the first fetch on every cold load.
  const { data: classroomData, isPending: classroomsLoading } = useQuery({
    queryKey: ["classrooms"],
    queryFn: () => listClassrooms(),
  });
  const classrooms = classroomData?.classrooms ?? [];

  const facultyHomeIsOverview = isFaculty && classrooms.length > 1;

  /*
    Auto-collapse on every navigation, at every width.

    On mobile that closes the off-canvas sheet, which used to sit over the page
    you'd just asked for. On desktop it drops to the icon rail and hands 16rem
    back to the content. Reopening is one click on the toggle above.

    Skipping the first run matters: without it, a deep link would land with the
    sidebar already closing.
  */
  const lastPath = useRef(currentPath);
  useEffect(() => {
    if (lastPath.current === currentPath) return;
    lastPath.current = currentPath;

    if (isMobile) setOpenMobile(false);
    else setOpen(false);
  }, [currentPath, isMobile, setOpenMobile, setOpen]);

  const logoutM = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut();
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Signed out");
      // Belt and braces: useAuthCacheSync also clears on the auth event, but doing
      // it here too means the cache is gone before we navigate, so nothing renders
      // the departing user's data on the way out.
      qc.clear();
      router.invalidate();
      router.navigate({ to: "/" });
    },
    onError: (e) => toast.error(String(e)),
  });

  return (
    /*
      No brand here — the top nav owns it. The offset parks the fixed panel
      below the nav bar instead of running the full viewport height, so the nav
      reads as the primary chrome. (Overrides `inset-y-0 h-svh` in ui/sidebar.)
    */
    <Sidebar
      collapsible="icon"
      // On small screens the menu drops down from the top rather than sliding in
      // from the left, so it reads as part of the nav bar it was opened from.
      mobileSide="top"
      className="top-(--app-header-h) h-[calc(100svh-var(--app-header-h))]"
    >
      {/* Collapse control sits at the top, where the eye lands first. Still no
          brand here — the nav bar owns that. */}
      <SidebarHeader className="p-2">
        <button
          onClick={isMobile ? () => setOpenMobile(false) : toggleSidebar}
          title={collapsed ? "Expand sidebar" : "Close menu"}
          aria-label={collapsed ? "Expand sidebar" : "Close menu"}
          className={cn(
            "flex h-8 items-center gap-2 rounded-md text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            collapsed ? "w-8 justify-center" : "w-full justify-end px-2",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4 shrink-0" />
          ) : isMobile ? (
            <>
              <span>Close</span>
              <X className="size-4 shrink-0" />
            </>
          ) : (
            <>
              <span>Collapse</span>
              <PanelLeftClose className="size-4 shrink-0" />
            </>
          )}
        </button>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Main</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {/* Hidden for multi-cohort faculty, whose home is Overview — the
                  dashboard redirects them there, so the link would only ever
                  bounce. See the note in _authenticated.dashboard.tsx. */}
              {!facultyHomeIsOverview && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={currentPath === "/dashboard"}>
                    <Link to="/dashboard" className="flex items-center gap-2">
                      <LayoutDashboard className="size-4" />
                      {!collapsed && <span>Dashboard</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              {/* Shown to faculty too. /overview has always been reachable by them
                  and the server scopes its data to their assignments — hiding the
                  link only meant they couldn't find a page they were allowed to use. */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={currentPath === "/overview"}>
                  <Link to="/overview" className="flex items-center gap-2">
                    <BarChart3 className="size-4" />
                    {!collapsed && <span>Overview</span>}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {/* The all-classrooms page: search, sort and jump between cohorts.
                  It already existed but was only reachable from Colleges, so
                  faculty with several cohorts had no way to reach it — the
                  per-classroom list below is fine for three, unwieldy for twenty.
                  Ungated for the same reason as Overview: the server scopes it. */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={currentPath === "/classrooms"}>
                  <Link to="/classrooms" className="flex items-center gap-2">
                    <Layers className="size-4" />
                    {!collapsed && <span>Classrooms</span>}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {/* Colleges is deliberately NOT admin-gated. A CEO's entire remit is
                  this page, and the server already scopes it to their assignments —
                  hiding the link would only stop them finding a page they own. */}
              {(isAdmin || role === "ceo" || isPO) && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={currentPath === "/colleges"}>
                    <Link to="/colleges" className="flex items-center gap-2">
                      <Building2 className="size-4" />
                      {!collapsed && <span>Colleges</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={currentPath === "/reports"}>
                  <Link to="/reports" className="flex items-center gap-2">
                    <FileSpreadsheet className="size-4" />
                    {!collapsed && <span>Reports</span>}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {/* Not role-gated, same rationale as Overview above: the server
                  already scopes rankings to what the caller can see. */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={currentPath === "/rankings"}>
                  <Link to="/rankings" className="flex items-center gap-2">
                    <Trophy className="size-4" />
                    {!collapsed && <span>Rankings</span>}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {roleLoading && (
                <>
                  <SidebarMenuSkeleton showIcon />
                  <SidebarMenuSkeleton showIcon />
                </>
              )}
              {isAdmin && (
                <>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={currentPath === "/import"}>
                      <Link to="/import" className="flex items-center gap-2">
                        <Upload className="size-4" />
                        {!collapsed && <span>Import</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={currentPath === "/staff"}>
                      <Link to="/staff" className="flex items-center gap-2">
                        <UserCog className="size-4" />
                        {!collapsed && <span>Staff</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={currentPath === "/settings"}>
                      <Link to="/settings" className="flex items-center gap-2">
                        <Settings2 className="size-4" />
                        {!collapsed && <span>Settings</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={currentPath === "/platforms"}>
                      <Link to="/platforms" className="flex items-center gap-2">
                        <Layers className="size-4" />
                        {!collapsed && <span>Platforms</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={currentPath === "/scrape-runs"}>
                      <Link to="/scrape-runs" className="flex items-center gap-2">
                        <History className="size-4" />
                        {!collapsed && <span>Scrape History</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Classrooms</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {classroomsLoading &&
                Array.from({ length: 3 }).map((_, i) => <SidebarMenuSkeleton key={i} showIcon />)}
              {!classroomsLoading && classrooms.length === 0 && !collapsed && (
                <div className="px-3 py-2 text-xs text-sidebar-foreground/70">
                  {isAdmin ? "No classrooms yet" : "None assigned yet"}
                </div>
              )}
              {classrooms.map((c) => {
                const active = currentPath.startsWith(`/classrooms/${c.id}`);
                return (
                  <SidebarMenuItem key={c.id}>
                    <SidebarMenuButton asChild isActive={active}>
                      <Link
                        to="/classrooms/$id"
                        params={{ id: c.id }}
                        className="flex items-center gap-2"
                      >
                        <span
                          className={active ? "text-sidebar-primary" : "text-sidebar-foreground/60"}
                        >
                          {active ? "●" : "○"}
                        </span>
                        {!collapsed && (
                          <>
                            <span className="truncate">{c.name}</span>
                            <span className="ml-auto font-mono text-3xs text-sidebar-foreground/70">
                              {c.student_count}
                            </span>
                          </>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        {!collapsed && (
          <div className="space-y-2 px-3 py-2">
            <div className="font-mono text-3xs text-sidebar-foreground/70">
              {roleLoading ? (
                <Skeleton className="h-3 w-20" />
              ) : (
                role && <span className="capitalize">{role.replace("_", " ")}</span>
              )}
            </div>
            <button
              onClick={() => setIsChangingPassword(true)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <Key className="size-3" /> Change Password
            </button>
            <button
              onClick={() => logoutM.mutate()}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <LogOut className="size-3" /> Sign out
            </button>
          </div>
        )}
      </SidebarFooter>

      {/*
        Change Password — was a hand-rolled `fixed inset-0` overlay with raw
        <input>s: no enter/exit animation, no focus trap, no Escape-to-close, and
        its own one-off input styling. Radix Dialog + the shared Input/Button
        primitives fix all of that and pick up the app's motion curves.
      */}
      <Dialog open={isChangingPassword} onOpenChange={setIsChangingPassword}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Change Password</DialogTitle>
            <DialogDescription>You'll stay signed in on this device.</DialogDescription>
          </DialogHeader>

          <form
            id="change-password-form"
            onSubmit={(e) => {
              e.preventDefault();
              changePwM.mutate();
            }}
            className="space-y-4"
          >
            <div>
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="mt-1"
                placeholder="At least 8 characters"
                minLength={8}
                required
              />
            </div>
            <div>
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1"
                placeholder="Type password again"
                required
              />
              {confirmPassword.length > 0 && confirmPassword !== newPassword && (
                <p className="mt-1 text-xs text-destructive">Passwords do not match</p>
              )}
            </div>
          </form>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsChangingPassword(false)}
              disabled={changePwM.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="change-password-form"
              disabled={
                changePwM.isPending || newPassword.length < 8 || newPassword !== confirmPassword
              }
            >
              {changePwM.isPending ? "Updating…" : "Update password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sidebar>
  );
}

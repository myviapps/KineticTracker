import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { BarChart3, Upload, UserCog, LayoutDashboard, LogOut, Settings2, Key, History } from "lucide-react";
import { useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
 
 import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const currentPath = useRouterState({ select: (r) => r.location.pathname });
  const router = useRouter();

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

  const { role, isAdmin, isPlacementOfficer: isPO, isLoading: roleLoading } = useRole();

  // `isPending` rather than the `= []` default: the sidebar showed "No classrooms
  // yet" during the first fetch on every cold load.
  const { data: classrooms = [], isPending: classroomsLoading } = useQuery({
    queryKey: ["classrooms"],
    queryFn: () => listClassrooms(),
  });

  const logoutM = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut();
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Signed out");
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
      className="top-(--app-header-h) h-[calc(100svh-var(--app-header-h))]"
    >
      <SidebarContent className="pt-2">
        <SidebarGroup>
          <SidebarGroupLabel>Main</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={currentPath === "/dashboard"}>
                  <Link to="/dashboard" className="flex items-center gap-2">
                    <LayoutDashboard className="size-4" />
                    {!collapsed && <span>Dashboard</span>}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
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
                Array.from({ length: 3 }).map((_, i) => (
                  <SidebarMenuSkeleton key={i} showIcon />
                ))}
              {!classroomsLoading && classrooms.length === 0 && !collapsed && (
                <div className="px-3 py-2 text-xs text-muted-foreground">
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
                          className={
                            active ? "text-primary" : "text-muted-foreground"
                          }
                        >
                          {active ? "●" : "○"}
                        </span>
                        {!collapsed && (
                          <>
                            <span className="truncate">{c.name}</span>
                            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
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
            <div className="font-mono text-[10px] text-muted-foreground">
              {roleLoading ? (
                <Skeleton className="h-3 w-20" />
              ) : (
                role && <span className="capitalize">{role.replace("_", " ")}</span>
              )}
            </div>
            <button
              onClick={() => setIsChangingPassword(true)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Key className="size-3" /> Change Password
            </button>
            <button
              onClick={() => logoutM.mutate()}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
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
            <DialogDescription>
              You'll stay signed in on this device.
            </DialogDescription>
          </DialogHeader>

          <form
            id="change-password-form"
            onSubmit={(e) => { e.preventDefault(); changePwM.mutate(); }}
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
                changePwM.isPending ||
                newPassword.length < 8 ||
                newPassword !== confirmPassword
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

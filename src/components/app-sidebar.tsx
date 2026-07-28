import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Terminal, BarChart3, Upload, UserCog, LayoutDashboard, LogOut, Settings2, Key, X, History } from "lucide-react";
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
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { listClassrooms } from "@/lib/classrooms.functions";
import { getCurrentUserClient } from "@/lib/auth.functions";
import { supabase } from "@/integrations/supabase/client";

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
      if (newPassword.length < 6) throw new Error("Password must be at least 6 characters");
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

  const { data: userData } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => getCurrentUserClient(),
  });
  const role = userData?.role;
  const isAdmin = role === "admin";
  const isPO = role === "placement_officer";
  const isFaculty = role === "faculty";

  const { data: classrooms = [] } = useQuery({
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
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link to="/dashboard" className="flex items-center gap-2 px-3 py-2">
          <div className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
            <Terminal className="size-4" strokeWidth={2.5} />
          </div>
          {!collapsed && (
            <span className="font-mono text-sm font-bold tracking-tight">
              KINETIC<span className="text-primary">/</span>LC
            </span>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent>
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
              {(isAdmin || isPO) && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={currentPath === "/overview"}>
                    <Link to="/overview" className="flex items-center gap-2">
                      <BarChart3 className="size-4" />
                      {!collapsed && <span>Overview</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
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
              {classrooms.length === 0 && !collapsed && (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  No classrooms yet
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
              {role && (
                <span className="capitalize">{role.replace("_", " ")}</span>
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

      {/* Change Password Modal */}
      {isChangingPassword && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          onClick={() => setIsChangingPassword(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-base font-bold">Change Password</h2>
              <button
                onClick={() => setIsChangingPassword(false)}
                className="grid size-7 place-items-center rounded border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            
            <form onSubmit={(e) => { e.preventDefault(); changePwM.mutate(); }} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="At least 6 characters"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Confirm New Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Type password again"
                  required
                />
              </div>
              
              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsChangingPassword(false)}
                  disabled={changePwM.isPending}
                  className="rounded-md border border-border bg-transparent px-4 py-2 text-sm font-medium hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={changePwM.isPending}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:brightness-110 disabled:opacity-50"
                >
                  {changePwM.isPending ? "Updating…" : "Update Password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Sidebar>
  );
}

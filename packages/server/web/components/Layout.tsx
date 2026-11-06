import { useEffect, useState, type ComponentType, type SVGProps } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, useLocation } from "react-router";
import { api, queryClient, type Group, type User } from "../api";
import { ActivityIcon, CloseIcon, GroupsIcon, KeyIcon, MenuIcon, OverviewIcon, PlusIcon, SignOutIcon, UsersIcon } from "./icons";
import { NewGroupModal } from "../pages/GroupsPage";
import { Logo } from "./Logo";

const navigation: Array<{ label: string; to: string; icon: ComponentType<SVGProps<SVGSVGElement>>; end?: boolean }> = [
  { label: "Overview", to: "/", icon: OverviewIcon, end: true },
  { label: "Env groups", to: "/groups", icon: GroupsIcon, end: true },
  { label: "Activity", to: "/activity", icon: ActivityIcon },
  { label: "API tokens", to: "/tokens", icon: KeyIcon },
  { label: "Members", to: "/members", icon: UsersIcon },
];

const itemClass = (isActive: boolean) =>
  [
    "group flex h-8 items-center gap-2 rounded-md px-2 text-sm font-medium outline-none transition-colors duration-150 motion-reduce:transition-none",
    "focus-visible:ring-2 focus-visible:ring-fuchsia-600 focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar",
    isActive ? "bg-sidebar-active text-neutral-950" : "text-neutral-600 hover:bg-sidebar-hover hover:text-neutral-950",
  ].join(" ");

function WorkspaceIdentity() {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Logo className="size-7" />
      <div className="min-w-0 leading-tight">
        <p className="truncate text-sm font-semibold text-neutral-950">secenv</p>
        <p className="truncate text-[11px] text-neutral-500">Environment workspace</p>
      </div>
    </div>
  );
}

function Sidebar({ user, onClose, onNavigate }: { user: User; onClose?: () => void; onNavigate?: () => void }) {
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const groups = useQuery({ queryKey: ["groups"], queryFn: () => api<{ groups: Group[] }>("/api/groups").then((r) => r.groups) });

  async function signOut() {
    setIsSigningOut(true);
    await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => undefined);
    queryClient.setQueryData(["me"], null);
    queryClient.clear();
    window.location.assign("/login");
  }

  return (
    <div className="flex h-full flex-col text-neutral-700">
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-3">
        <WorkspaceIdentity />
        {onClose ? (
          <button
            className="ml-auto grid size-8 place-items-center rounded-md text-neutral-500 outline-none hover:bg-neutral-200 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-fuchsia-600"
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <CloseIcon className="size-4" />
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-3">
        <nav className="space-y-0.5" aria-label="Main navigation">
          {navigation.map((item) => (
            <NavLink className={({ isActive }) => itemClass(isActive)} key={item.to} to={item.to} end={item.end} onClick={onNavigate}>
              <item.icon className="size-[18px] shrink-0 text-neutral-500 group-hover:text-neutral-700" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="mt-6">
          <div className="group/section flex items-center justify-between px-2 pb-1.5">
            <p className="text-xs font-medium text-neutral-500">Groups</p>
            <button
              type="button"
              className="grid size-5 place-items-center rounded text-neutral-400 outline-none hover:bg-sidebar-hover hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-fuchsia-600"
              aria-label="New env group"
              title="New env group"
              onClick={() => setNewGroupOpen(true)}
            >
              <PlusIcon className="size-3.5" />
            </button>
          </div>
          <div className="space-y-0.5">
            {groups.data?.map((group) => (
              <NavLink className={({ isActive }) => itemClass(isActive)} key={group.id} to={`/groups/${group.id}`} onClick={onNavigate}>
                <span className="grid size-[18px] shrink-0 place-items-center">
                  <span className="size-1.5 rounded-full bg-neutral-400 group-hover:bg-neutral-600" />
                </span>
                <span className="truncate font-mono text-[13px]">{group.name}</span>
                <span className="ml-auto text-[11px] tabular-nums text-neutral-400">{group.variableCount}</span>
              </NavLink>
            ))}
            {groups.data?.length === 0 ? <p className="px-2 py-1 text-xs text-neutral-400">No groups yet</p> : null}
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-neutral-200/80 p-2">
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="grid size-7 shrink-0 place-items-center rounded-full bg-fuchsia-100 text-xs font-semibold text-fuchsia-800" aria-hidden="true">
            {(user.name || user.email).charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-xs font-medium text-neutral-800" title={user.email}>
              {user.name || user.email}
            </p>
            {user.name ? <p className="mt-0.5 truncate text-[11px] text-neutral-500">{user.email}</p> : null}
          </div>
        </div>
        <button className={`${itemClass(false)} w-full disabled:opacity-50`} type="button" onClick={() => void signOut()} disabled={isSigningOut}>
          <SignOutIcon className="size-[18px] shrink-0 text-neutral-500" />
          {isSigningOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
      <NewGroupModal open={newGroupOpen} onClose={() => setNewGroupOpen(false)} />
    </div>
  );
}

export function Layout({ user }: { user: User }) {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => setMobileOpen(false), [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [mobileOpen]);

  return (
    <div className="min-h-dvh bg-white font-sans text-neutral-950 antialiased">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-neutral-200/80 bg-sidebar lg:block">
        <Sidebar user={user} />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button className="absolute inset-0 bg-neutral-950/25" type="button" onClick={() => setMobileOpen(false)} aria-hidden="true" tabIndex={-1} />
          <aside className="absolute inset-y-0 left-0 w-[min(18rem,calc(100vw-3rem))] border-r border-neutral-200 bg-sidebar shadow-lg">
            <Sidebar user={user} onClose={() => setMobileOpen(false)} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="min-h-dvh lg:pl-64">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-neutral-200/80 bg-white/95 px-3 backdrop-blur-sm lg:hidden">
          <button
            className="grid size-8 place-items-center rounded-md text-neutral-600 outline-none hover:bg-neutral-100 hover:text-neutral-950 focus-visible:ring-2 focus-visible:ring-fuchsia-600"
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
          >
            <MenuIcon className="size-5" />
          </button>
          <Logo className="size-6" />
          <p className="text-sm font-semibold text-neutral-900">secenv</p>
        </header>

        <main className="mx-auto w-full max-w-[80rem] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

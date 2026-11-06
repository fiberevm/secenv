import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, type User } from "../api";
import { Card, CountBadge, PageHeader, Skeleton } from "../components/ui";
import { formatDateTime, timeAgo } from "../format";

export function MembersPage() {
  const users = useQuery({ queryKey: ["users"], queryFn: () => api<{ users: User[] }>("/api/users").then((r) => r.users) });

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            Members <CountBadge>{users.data?.length ?? "…"}</CountBadge>
          </span>
        }
        description="People who can sign in. Access is controlled by the auth settings in secenv.toml (sign-up, SSO, allowed email domains)."
      />
      <Card>
        {users.isPending ? (
          <div className="p-4">
            <Skeleton className="h-4 w-56" />
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {users.data?.map((user) => (
              <li key={user.id} className="flex items-center gap-3 px-4 py-3">
                <div className="grid size-8 shrink-0 place-items-center rounded-full bg-fuchsia-100 text-xs font-semibold text-fuchsia-800">
                  {(user.name || user.email).charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-neutral-900">{user.name || user.email}</p>
                  {user.name ? <p className="truncate text-xs text-neutral-500">{user.email}</p> : null}
                </div>
                <div className="hidden text-right text-xs text-neutral-500 sm:block">
                  <p title={user.lastLoginAt ? formatDateTime(user.lastLoginAt) : undefined}>
                    {user.lastLoginAt ? `Active ${timeAgo(user.lastLoginAt)}` : "Never signed in"}
                  </p>
                  <p>Joined {formatDateTime(user.createdAt)}</p>
                </div>
                <Link to={`/activity?actor=${encodeURIComponent(user.email)}`} className="text-xs font-medium text-brand hover:underline">
                  Activity
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

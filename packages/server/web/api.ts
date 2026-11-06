import { QueryClient } from "@tanstack/react-query";
import type { ApiToken, AuditEvent, Group, User, Variable, VariableMeta, ViewSource } from "../src/store";

export type { ApiToken, AuditEvent, Group, User, Variable, VariableMeta, ViewSource };

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? "GET",
    headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/api/auth")) {
      queryClient.setQueryData(["me"], null);
    }
    throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
      refetchOnWindowFocus: true,
      staleTime: 5_000,
    },
  },
});

export type AuthConfig = {
  password: { signupOpen: boolean } | null;
  oidc: { name: string } | null;
  needsSetup: boolean;
};

export type Stats = {
  groups: number;
  variables: number;
  tokens: number;
  users: number;
  changes7d: number;
  views7d: number;
  reads7d: number;
  changesPrev7d: number;
  daily: Array<{ day: string; action: string; n: number }>;
  topGroups: Array<{ id: string; name: string; changes: number }>;
  topActors: Array<{ label: string; kind: string; changes: number }>;
};

export type ActivityPage = { events: AuditEvent[]; nextCursor: number | null; actors: string[] };

/** Every mutation touches the audit log, so refresh the shared views together. */
export function invalidateAll() {
  return queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" && q.queryKey[0] !== "auth-config" });
}

/** Fetch decrypted values. The server records one view per key returned. */
export async function revealValues(groupId: string, ids: string[] | null, source: ViewSource): Promise<Record<string, string>> {
  const { values } = await api<{ values: Record<string, string> }>(`/api/groups/${groupId}/variables/reveal`, {
    method: "POST",
    body: { ids, source },
  });
  // The view shows up in the activity log right away.
  void queryClient.invalidateQueries({ queryKey: ["activity"] });
  return values;
}

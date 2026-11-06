import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, invalidateAll, type ApiToken, type Group } from "../api";
import { KeyIcon, PlusIcon, TrashIcon } from "../components/icons";
import { Button, Card, CodeBlock, CountBadge, EmptyState, ErrorBanner, Field, IconButton, Input, Modal, PageHeader, Skeleton, Tag } from "../components/ui";
import { formatDateTime, timeAgo } from "../format";

function CreateTokenModal({ open, onClose, groups }: { open: boolean; onClose: () => void; groups: Group[] }) {
  const [name, setName] = useState("");
  const [access, setAccess] = useState<"read" | "write">("read");
  const [allGroups, setAllGroups] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const create = useMutation({
    mutationFn: () =>
      api<{ token: ApiToken; secret: string }>("/api/tokens", {
        method: "POST",
        body: { name, access, groupIds: allGroups ? null : selected },
      }),
    onSuccess: () => invalidateAll(),
  });

  function close() {
    setName("");
    setAccess("read");
    setAllGroups(true);
    setSelected([]);
    create.reset();
    onClose();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  const secret = create.data?.secret;
  const origin = window.location.origin;

  return (
    <Modal open={open} onClose={close} wide title={secret ? "Copy your token" : "New API token"} description={secret ? "This is the only time the token is shown. Store it in your deploy platform's secrets." : "Tokens let services, the CLI and MCP clients read env groups."}>
      {secret ? (
        <div className="space-y-3">
          <CodeBlock label="Token" code={secret} />
          <CodeBlock label="Environment for the SDK / CLI" code={`SECENV_URL=${origin}\nSECENV_TOKEN=${secret}`} />
          <CodeBlock
            label="MCP (Claude Code)"
            code={`claude mcp add --transport http secenv ${origin}/mcp \\\n  --header "Authorization: Bearer ${secret}"`}
          />
          <div className="flex justify-end">
            <Button onClick={close}>Done</Button>
          </div>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          <ErrorBanner error={create.error} />
          <Field label="Name" hint="Where the token is used, e.g. api-production or claude-desktop.">
            <Input autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="api-production" />
          </Field>

          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium text-neutral-800">Access</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["read", "Read-only", "Load variables with the SDK, CLI or MCP read tools."],
                  ["write", "Read & write", "Also lets MCP clients create, edit and delete variables."],
                ] as const
              ).map(([value, label, hint]) => (
                <label
                  key={value}
                  className={`cursor-pointer rounded-lg border px-3 py-2.5 transition-colors ${access === value ? "border-brand bg-sky-50/50 ring-1 ring-brand" : "border-neutral-200 hover:border-neutral-300"}`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-neutral-900">
                    <input type="radio" name="access" className="accent-brand" checked={access === value} onChange={() => setAccess(value)} />
                    {label}
                  </span>
                  <span className="mt-0.5 block pl-5 text-xs leading-5 text-neutral-500">{hint}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium text-neutral-800">Groups</legend>
            <label className="flex items-center gap-2 text-[13px] text-neutral-700">
              <input type="checkbox" className="size-4 accent-brand" checked={allGroups} onChange={(e) => setAllGroups(e.target.checked)} />
              All groups, including ones created later
            </label>
            {!allGroups ? (
              <div className="mt-2 max-h-48 space-y-0.5 overflow-y-auto rounded-lg border border-neutral-200 p-1.5">
                {groups.length === 0 ? <p className="px-2 py-1 text-xs text-neutral-500">No groups yet.</p> : null}
                {groups.map((g) => (
                  <label key={g.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-neutral-50">
                    <input
                      type="checkbox"
                      className="size-4 accent-brand"
                      checked={selected.includes(g.id)}
                      onChange={(e) => setSelected(e.target.checked ? [...selected, g.id] : selected.filter((id) => id !== g.id))}
                    />
                    <span className="font-mono">{g.name}</span>
                  </label>
                ))}
              </div>
            ) : null}
          </fieldset>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" isLoading={create.isPending} disabled={!name.trim() || (!allGroups && selected.length === 0)}>
              Create token
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function TokensPage() {
  const [open, setOpen] = useState(false);
  const [revoking, setRevoking] = useState<ApiToken | null>(null);
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: () => api<{ tokens: ApiToken[] }>("/api/tokens").then((r) => r.tokens) });
  const groups = useQuery({ queryKey: ["groups"], queryFn: () => api<{ groups: Group[] }>("/api/groups").then((r) => r.groups) });
  const groupName = (id: string) => groups.data?.find((g) => g.id === id)?.name;
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/tokens/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await invalidateAll();
      setRevoking(null);
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            API tokens <CountBadge>{tokens.data?.length ?? "…"}</CountBadge>
          </span>
        }
        description="Tokens authenticate the SDK, the CLI and MCP clients. Scope them to the groups a service needs."
        actions={
          <Button onClick={() => setOpen(true)}>
            <PlusIcon className="size-4" />
            New token
          </Button>
        }
      />

      <Card>
        {tokens.isPending ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        ) : tokens.data?.length === 0 ? (
          <EmptyState
            icon={<KeyIcon className="size-5" />}
            title="No API tokens"
            description="Create a token for each service or MCP client that needs to read your env groups."
            action={<Button onClick={() => setOpen(true)}>New token</Button>}
          />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50/70 text-xs text-neutral-500">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Access</th>
                <th className="hidden px-4 py-2 font-medium md:table-cell">Groups</th>
                <th className="hidden px-4 py-2 font-medium sm:table-cell">Last used</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {tokens.data?.map((token) => (
                <tr key={token.id} className="hover:bg-neutral-50/70">
                  <td className="px-4 py-3">
                    <p className="font-medium text-neutral-900">{token.name}</p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      <code className="font-mono">{token.prefix}…</code> · created by {token.createdBy} {timeAgo(token.createdAt)}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <Tag tone={token.access === "write" ? "amber" : "neutral"}>{token.access === "write" ? "Read & write" : "Read-only"}</Tag>
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">
                    {token.groupIds === null ? (
                      <span className="text-[13px] text-neutral-600">All groups</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {token.groupIds.map((id) => (
                          <span key={id} className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] text-neutral-700">
                            {groupName(id) ?? "deleted"}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 text-[13px] text-neutral-500 sm:table-cell" title={token.lastUsedAt ? formatDateTime(token.lastUsedAt) : undefined}>
                    {token.lastUsedAt ? timeAgo(token.lastUsedAt) : "Never"}
                  </td>
                  <td className="pr-3">
                    <IconButton label={`Revoke ${token.name}`} className="hover:!bg-red-50 hover:!text-red-700" onClick={() => setRevoking(token)}>
                      <TrashIcon className="size-3.5" />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <CreateTokenModal open={open} onClose={() => setOpen(false)} groups={groups.data ?? []} />
      <Modal open={revoking !== null} onClose={() => setRevoking(null)} title={`Revoke ${revoking?.name}?`} description="Anything using this token stops loading variables immediately.">
        <ErrorBanner error={revoke.error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setRevoking(null)}>
            Cancel
          </Button>
          <Button variant="dangerSolid" isLoading={revoke.isPending} onClick={() => revoking && revoke.mutate(revoking.id)}>
            Revoke token
          </Button>
        </div>
      </Modal>
    </div>
  );
}

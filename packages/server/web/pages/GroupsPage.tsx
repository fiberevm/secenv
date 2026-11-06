import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { api, invalidateAll, type Group } from "../api";
import { ChevronRightIcon, GroupsIcon, PlusIcon, SearchIcon } from "../components/icons";
import { Button, Card, CountBadge, EmptyState, ErrorBanner, Field, Input, Modal, PageHeader, Skeleton } from "../components/ui";
import { formatDateTime, pluralize, timeAgo } from "../format";

export function NewGroupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = useMutation({
    mutationFn: () => api<{ group: Group }>("/api/groups", { method: "POST", body: { name, description } }),
    onSuccess: async ({ group }) => {
      await invalidateAll();
      close();
      navigate(`/groups/${group.id}`);
    },
  });

  function close() {
    setName("");
    setDescription("");
    create.reset();
    onClose();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <Modal open={open} onClose={close} title="New env group" description="A named set of variables you can load into one or more services.">
      <form className="space-y-4" onSubmit={submit}>
        <ErrorBanner error={create.error} />
        <Field label="Name" hint="Letters, numbers, dots, dashes and underscores. Services load groups by this name.">
          <Input
            autoFocus
            required
            className="font-mono"
            placeholder="backend-production"
            value={name}
            onChange={(e) => setName(e.target.value.replace(/\s+/g, "-"))}
          />
        </Field>
        <Field label="Description">
          <Input placeholder="Shared by the API and worker in production" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" isLoading={create.isPending} disabled={!name.trim()}>
            Create group
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function GroupsPage() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const groups = useQuery({ queryKey: ["groups"], queryFn: () => api<{ groups: Group[] }>("/api/groups").then((r) => r.groups) });
  const filtered = (groups.data ?? []).filter((g) => `${g.name} ${g.description}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            Env groups <CountBadge>{groups.data?.length ?? "…"}</CountBadge>
          </span>
        }
        description="Each group is a named set of variables. A service can load several groups; later groups override earlier ones."
        actions={
          <Button onClick={() => setOpen(true)}>
            <PlusIcon className="size-4" />
            New group
          </Button>
        }
      />

      {groups.data && groups.data.length > 0 ? (
        <div className="relative max-w-xs">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
          <Input className="pl-8" placeholder="Filter groups" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Filter groups" />
        </div>
      ) : null}

      <Card>
        {groups.isPending ? (
          <div className="divide-y divide-neutral-100">
            {[0, 1, 2].map((i) => (
              <div key={i} className="px-4 py-4">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="mt-2 h-3 w-64" />
              </div>
            ))}
          </div>
        ) : groups.error ? (
          <p className="px-4 py-10 text-center text-sm text-red-700">Could not load env groups.</p>
        ) : groups.data!.length === 0 ? (
          <EmptyState
            icon={<GroupsIcon className="size-5" />}
            title="No env groups yet"
            description="Create a group like backend-production, add variables, then load it from your app with the SDK."
            action={<Button onClick={() => setOpen(true)}>New group</Button>}
          />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50/70 text-xs font-medium text-neutral-500">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="hidden px-4 py-2 font-medium sm:table-cell">Variables</th>
                <th className="hidden px-4 py-2 font-medium md:table-cell">Last updated</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {filtered.map((group) => (
                <tr key={group.id} className="group relative hover:bg-neutral-50/70">
                  <td className="px-4 py-3">
                    <Link to={`/groups/${group.id}`} className="font-mono text-[13px] font-medium text-neutral-950 outline-none after:absolute after:inset-0 focus-visible:underline">
                      {group.name}
                    </Link>
                    {group.description ? <p className="mt-0.5 truncate text-[13px] text-neutral-500">{group.description}</p> : null}
                  </td>
                  <td className="hidden px-4 py-3 tabular-nums text-neutral-600 sm:table-cell">{pluralize(group.variableCount, "variable")}</td>
                  <td className="hidden px-4 py-3 text-neutral-500 md:table-cell" title={formatDateTime(group.updatedAt)}>
                    {timeAgo(group.updatedAt)}
                  </td>
                  <td className="pr-3 text-neutral-300 group-hover:text-neutral-500">
                    <ChevronRightIcon className="size-4" />
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-[13px] text-neutral-500">
                    No groups match “{search}”.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
      </Card>

      <NewGroupModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

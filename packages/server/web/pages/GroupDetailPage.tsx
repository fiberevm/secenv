import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { api, invalidateAll, revealValues, type ActivityPage, type Group, type VariableMeta, type ViewSource } from "../api";
import { ActivityList } from "../components/ActivityFeed";
import { RobotIcon, UsersIcon, EyeIcon, EyeOffIcon, PencilIcon, PlusIcon, SearchIcon, TrashIcon, UploadIcon } from "../components/icons";
import { Button, Card, CodeBlock, CopyButton, EmptyState, ErrorBanner, Field, IconButton, Input, Modal, PageHeader, Skeleton, Spinner, Textarea } from "../components/ui";
import { formatDateTime, pluralize, timeAgo } from "../format";

type GroupDetail = { group: Group; variables: VariableMeta[] };
type Tab = "variables" | "activity" | "connect";

const MASK = "••••••••••••";

function looksLikeDotenv(text: string) {
  return /^\s*(export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/m.test(text) && text.includes("\n");
}

function VariableEditor({
  initialKey = "",
  initialValue = "",
  submitLabel,
  isSaving,
  error,
  onSubmit,
  onCancel,
  onPasteDotenv,
}: {
  initialKey?: string;
  initialValue?: string;
  submitLabel: string;
  isSaving: boolean;
  error: unknown;
  onSubmit: (key: string, value: string) => void;
  onCancel: () => void;
  onPasteDotenv?: (text: string) => void;
}) {
  const [key, setKey] = useState(initialKey);
  const [value, setValue] = useState(initialValue);
  const valueRef = useRef<HTMLTextAreaElement>(null);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (key.trim()) onSubmit(key.trim(), value);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") onCancel();
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
  }

  return (
    <form onSubmit={submit} onKeyDown={onKeyDown} className="space-y-2 bg-[#fbfbfa] px-4 py-3">
      {error ? <ErrorBanner error={error} /> : null}
      <div className="grid gap-2 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        <Input
          autoFocus={!initialKey}
          aria-label="Key"
          placeholder="KEY"
          className="font-mono text-[13px]"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (onPasteDotenv && looksLikeDotenv(text)) {
              e.preventDefault();
              onPasteDotenv(text);
              return;
            }
            // Pasting a single KEY=value line splits it into both fields.
            const single = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(text);
            if (single && !text.includes("\n")) {
              e.preventDefault();
              setKey(single[1]!);
              setValue(single[2]!.replace(/^(['"])(.*)\1$/, "$2"));
              valueRef.current?.focus();
            }
          }}
        />
        <Textarea
          ref={valueRef}
          autoFocus={Boolean(initialKey)}
          aria-label="Value"
          placeholder="value"
          rows={Math.min(Math.max(value.split("\n").length, 1), 8)}
          className="min-h-9 resize-y font-mono text-[13px] leading-5"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="hidden text-xs text-neutral-400 sm:block">
          <kbd className="font-sans">⌘</kbd>+<kbd className="font-sans">Enter</kbd> to save · <kbd className="font-sans">Esc</kbd> to cancel
          {onPasteDotenv ? " · paste a .env to import many" : ""}
        </p>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" type="submit" isLoading={isSaving} disabled={!key.trim()}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** A "when · who" cell. The time shows relative, the full timestamp is in the tooltip. */
function MetaCell({ label, at, by, empty = "—", machine }: { label: string; at: number | null; by: string | null; empty?: string; machine?: boolean }) {
  if (at === null) {
    return <div className="hidden pt-0.5 text-xs text-neutral-300 lg:block">{empty}</div>;
  }
  return (
    <div className="hidden min-w-0 pt-0.5 leading-tight lg:block" title={`${label} ${formatDateTime(at)}${by ? ` by ${by}` : ""}`}>
      <p className="text-xs text-neutral-700">{timeAgo(at)}</p>
      {by ? (
        <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-neutral-500">
          {machine ? <RobotIcon className="size-3 shrink-0 text-violet-500" /> : null}
          <span className="truncate">{by}</span>
        </p>
      ) : null}
    </div>
  );
}

function VariableRow({ groupId, variable, bulkValue }: { groupId: string; variable: VariableMeta; bulkValue: string | undefined }) {
  // Values are fetched per reveal; hiding forgets them, so every reveal is a logged view.
  const [value, setValue] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const shownValue = bulkValue ?? value;
  const modified = variable.updatedAt > variable.createdAt;
  const shown = shownValue !== null;

  async function fetchValue(source: ViewSource): Promise<string> {
    const values = await revealValues(groupId, [variable.id], source);
    return values[variable.id] ?? "";
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const update = useMutation({
    mutationFn: (input: { key: string; value: string }) =>
      api(`/api/groups/${groupId}/variables/${variable.id}`, { method: "PATCH", body: input }),
    onSuccess: async () => {
      await invalidateAll();
      setEditValue(null);
      setValue(null);
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/groups/${groupId}/variables/${variable.id}`, { method: "DELETE" }),
    onSuccess: () => invalidateAll(),
  });

  if (editValue !== null) {
    return (
      <li>
        <VariableEditor
          initialKey={variable.key}
          initialValue={editValue}
          submitLabel="Save"
          isSaving={update.isPending}
          error={update.error}
          onSubmit={(key, next) => update.mutate({ key, value: next })}
          onCancel={() => {
            update.reset();
            setEditValue(null);
          }}
        />
      </li>
    );
  }

  return (
    <li className="group/var grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-neutral-50/70 lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_8.5rem_8.5rem_8.5rem_9rem]">
      <div className="min-w-0 pt-0.5">
        <span className="break-all font-mono text-[13px] font-medium text-neutral-950">{variable.key}</span>
      </div>
      <div className="col-span-2 row-start-2 min-w-0 pt-0.5 lg:col-span-1 lg:row-start-auto">
        {shown ? (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[13px] leading-5 text-neutral-800">
            {shownValue || <span className="italic text-neutral-400">empty</span>}
          </pre>
        ) : (
          <button
            type="button"
            className="inline-flex items-center gap-2 font-mono text-[13px] tracking-wider text-neutral-400 hover:text-neutral-600 disabled:cursor-wait"
            onClick={() => run(async () => setValue(await fetchValue("reveal")))}
            disabled={busy}
            title="Reveal value (logged)"
          >
            {MASK}
            {busy ? <Spinner className="size-3" /> : null}
          </button>
        )}
        {error ? <p className="mt-1 text-xs text-red-700">{error instanceof Error ? error.message : "Could not load value"}</p> : null}
      </div>
      <MetaCell label="Added" at={variable.createdAt} by={variable.createdBy} />
      <MetaCell label="Modified" at={modified ? variable.updatedAt : null} by={modified ? variable.updatedBy : null} empty="Never" />
      <MetaCell label="Last loaded" at={variable.lastLoadedAt} by={variable.lastLoadedBy} empty="Never" machine />
      {/* Below lg the three columns collapse into one line under the value. */}
      <p className="col-span-2 row-start-3 text-[11px] leading-4 text-neutral-500 lg:hidden">
        Added {timeAgo(variable.createdAt)} by {variable.createdBy || "unknown"}
        {modified ? ` · modified ${timeAgo(variable.updatedAt)} by ${variable.updatedBy}` : ""}
        {variable.lastLoadedAt ? ` · loaded ${timeAgo(variable.lastLoadedAt)} by ${variable.lastLoadedBy}` : " · never loaded"}
      </p>
      <div className="col-start-2 row-start-1 flex items-center justify-end gap-0.5 opacity-100 lg:col-start-auto lg:row-start-auto lg:opacity-0 lg:group-hover/var:opacity-100 lg:focus-within:opacity-100">
        <IconButton
          label={shown ? "Hide value" : "Reveal value (logged)"}
          disabled={bulkValue !== undefined || busy}
          onClick={() => (shown ? setValue(null) : run(async () => setValue(await fetchValue("reveal"))))}
        >
          {shown ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
        </IconButton>
        <CopyButton label="Copy value (logged)" getText={() => fetchValue("copy")} />
        <IconButton label="Edit" disabled={busy} onClick={() => run(async () => setEditValue(shownValue ?? (await fetchValue("edit"))))}>
          <PencilIcon className="size-3.5" />
        </IconButton>
        <Link
          to={`/access?group=${groupId}&key=${encodeURIComponent(variable.key)}&days=0`}
          aria-label="Who has seen this value"
          title="Who has seen this value"
          className="grid size-7 shrink-0 place-items-center rounded-md text-neutral-400 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-fuchsia-600"
        >
          <UsersIcon className="size-3.5" />
        </Link>
        <IconButton label="Delete" className="hover:!bg-red-50 hover:!text-red-700" onClick={() => setConfirmDelete(true)}>
          <TrashIcon className="size-3.5" />
        </IconButton>
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${variable.key}?`}
        description="Services stop receiving this variable the next time they load. The old value stays in the activity log."
      >
        <ErrorBanner error={remove.error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          <Button variant="dangerSolid" isLoading={remove.isPending} onClick={() => remove.mutate()}>
            Delete variable
          </Button>
        </div>
      </Modal>
    </li>
  );
}

function ImportModal({ group, open, initialText, onClose }: { group: Group; open: boolean; initialText: string; onClose: () => void }) {
  const [content, setContent] = useState(initialText);
  const [overwrite, setOverwrite] = useState(true);
  useEffect(() => setContent(initialText), [initialText, open]);
  const importEnv = useMutation({
    mutationFn: () =>
      api<{ summary: { created: number; updated: number; unchanged: number; skipped: number } }>(`/api/groups/${group.id}/import`, {
        method: "POST",
        body: { content, overwrite },
      }),
    onSuccess: () => invalidateAll(),
  });
  const close = () => {
    importEnv.reset();
    onClose();
  };
  const summary = importEnv.data?.summary;

  return (
    <Modal open={open} onClose={close} wide title={`Import into ${group.name}`} description="Paste the contents of a .env file. Every created or changed key is recorded in the activity log.">
      {summary ? (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-2 text-center">
            {(
              [
                ["Created", summary.created, "text-emerald-700"],
                ["Updated", summary.updated, "text-sky-700"],
                ["Unchanged", summary.unchanged, "text-neutral-600"],
                ["Skipped", summary.skipped, "text-neutral-600"],
              ] as const
            ).map(([label, n, tone]) => (
              <div key={label} className="rounded-lg border border-neutral-200 px-2 py-3">
                <p className={`text-xl font-semibold tabular-nums ${tone}`}>{n}</p>
                <p className="text-xs text-neutral-500">{label}</p>
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <Button onClick={close}>Done</Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            importEnv.mutate();
          }}
        >
          <ErrorBanner error={importEnv.error} />
          <Textarea
            autoFocus
            rows={12}
            spellCheck={false}
            className="font-mono text-[12.5px] leading-5"
            placeholder={"DATABASE_URL=postgres://…\nREDIS_URL=redis://…\n# comments are ignored"}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <label className="flex items-center gap-2 text-[13px] text-neutral-700">
            <input type="checkbox" className="size-4 accent-brand" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
            Overwrite keys that already exist
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" isLoading={importEnv.isPending} disabled={!content.trim()}>
              Import
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function SettingsModal({ group, open, onClose }: { group: Group; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description);
  const [confirmName, setConfirmName] = useState("");
  useEffect(() => {
    setName(group.name);
    setDescription(group.description);
    setConfirmName("");
  }, [group, open]);

  const save = useMutation({
    mutationFn: () => api(`/api/groups/${group.id}`, { method: "PATCH", body: { name, description } }),
    onSuccess: async () => {
      await invalidateAll();
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/groups/${group.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      navigate("/groups");
      await invalidateAll();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Group settings">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <ErrorBanner error={save.error} />
        <Field label="Name" hint="Renaming breaks services that load this group by its old name.">
          <Input className="font-mono" value={name} onChange={(e) => setName(e.target.value.replace(/\s+/g, "-"))} required />
        </Field>
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={save.isPending}>
            Save changes
          </Button>
        </div>
      </form>

      <div className="mt-6 rounded-lg border border-red-200 p-4">
        <h3 className="text-sm font-semibold text-red-800">Delete this group</h3>
        <p className="mt-1 text-[13px] leading-5 text-neutral-600">
          Deletes {pluralize(group.variableCount, "variable")}. Services loading <code className="font-mono">{group.name}</code> will fail. Type the group name to confirm.
        </p>
        <ErrorBanner error={remove.error} />
        <div className="mt-3 flex gap-2">
          <Input className="font-mono" placeholder={group.name} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} aria-label="Type the group name to confirm" />
          <Button variant="dangerSolid" disabled={confirmName !== group.name} isLoading={remove.isPending} onClick={() => remove.mutate()}>
            Delete
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ConnectPanel({ group }: { group: Group }) {
  const origin = window.location.origin;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-neutral-900">TypeScript SDK</h3>
        <p className="text-[13px] text-neutral-600">
          Loads the group into <code className="font-mono">process.env</code> at startup. Needs an{" "}
          <Link to="/tokens" className="font-medium text-brand hover:underline">
            API token
          </Link>
          .
        </p>
        <CodeBlock label="Install" code="bun add @secenv/sdk   # or npm i @secenv/sdk" />
        <CodeBlock
          label="index.ts"
          code={`import { loadEnv } from "@secenv/sdk";

// Reads SECENV_URL and SECENV_TOKEN from the environment
await loadEnv({ groups: ["${group.name}"] });

console.log(process.env.DATABASE_URL);`}
        />
        <CodeBlock label=".env (or your platform's env)" code={`SECENV_URL=${origin}\nSECENV_TOKEN=se_…`} />
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-neutral-900">CLI</h3>
        <p className="text-[13px] text-neutral-600">Run any command with the group injected, or write a .env file.</p>
        <CodeBlock label="Shell" code={`npx secenv run -g ${group.name} -- node server.js\nnpx secenv export -g ${group.name} > .env`} />
        <h3 className="pt-2 text-sm font-semibold text-neutral-900">HTTP</h3>
        <CodeBlock label="curl" code={`curl -H "Authorization: Bearer $SECENV_TOKEN" \\\n  "${origin}/api/v1/env?groups=${group.name}&format=dotenv"`} />
        <h3 className="pt-2 text-sm font-semibold text-neutral-900">MCP</h3>
        <CodeBlock label="Claude Code" code={`claude mcp add --transport http secenv ${origin}/mcp \\\n  --header "Authorization: Bearer $SECENV_TOKEN"`} />
      </div>
    </div>
  );
}

export function GroupDetailPage() {
  const { groupId } = useParams();
  const [tab, setTab] = useState<Tab>("variables");
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  // Values fetched by "Reveal values", keyed by variable id. null = hidden.
  const [bulkValues, setBulkValues] = useState<Record<string, string> | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<unknown>(null);
  const [importText, setImportText] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const detail = useQuery({ queryKey: ["group", groupId], queryFn: () => api<GroupDetail>(`/api/groups/${groupId}`) });
  const activity = useQuery({
    queryKey: ["activity", "group", groupId],
    queryFn: () => api<ActivityPage>(`/api/activity?group=${groupId}&limit=100`),
    enabled: tab === "activity",
  });
  const create = useMutation({
    mutationFn: (input: { key: string; value: string }) => api(`/api/groups/${groupId}/variables`, { method: "POST", body: input }),
    onSuccess: async () => {
      await invalidateAll();
      setAdding(false);
    },
  });

  useEffect(() => {
    setTab("variables");
    setAdding(false);
    setSearch("");
    setBulkValues(null);
  }, [groupId]);

  if (detail.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (detail.error || !detail.data) {
    return (
      <EmptyState
        title="Env group not found"
        description={detail.error instanceof Error ? detail.error.message : undefined}
        action={
          <Link to="/groups" className="text-sm font-medium text-brand hover:underline">
            Back to env groups
          </Link>
        }
      />
    );
  }

  const { group, variables } = detail.data;
  const filtered = variables.filter((v) => v.key.toLowerCase().includes(search.toLowerCase()));

  async function toggleRevealAll() {
    if (bulkValues) return setBulkValues(null);
    setBulkBusy(true);
    setBulkError(null);
    try {
      setBulkValues(await revealValues(group.id, null, "reveal"));
    } catch (err) {
      setBulkError(err);
    } finally {
      setBulkBusy(false);
    }
  }

  async function exportDotenv() {
    // Always fetch: an export is logged as a copy of every key, even if the values are on screen.
    const values = await revealValues(group.id, null, "export");
    return variables.map((v) => `${v.key}=${JSON.stringify(values[v.id] ?? "")}`).join("\n") + "\n";
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "variables", label: "Variables" },
    { id: "activity", label: "Activity" },
    { id: "connect", label: "Connect" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={
          <Link to="/groups" className="hover:text-neutral-800">
            Env groups
          </Link>
        }
        title={<span className="font-mono">{group.name}</span>}
        description={group.description || undefined}
        actions={
          <Button variant="secondary" onClick={() => setSettingsOpen(true)}>
            Settings
          </Button>
        }
      />

      <div className="flex gap-4 border-b border-neutral-200" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px inline-flex h-9 items-center gap-1.5 border-b-2 px-0.5 text-sm font-medium outline-none transition-colors focus-visible:text-neutral-950 ${tab === t.id ? "border-neutral-900 text-neutral-950" : "border-transparent text-neutral-500 hover:text-neutral-800"}`}
          >
            {t.label}
            {t.id === "variables" ? <span className="rounded-full bg-neutral-100 px-1.5 text-[11px] tabular-nums text-neutral-600">{variables.length}</span> : null}
          </button>
        ))}
      </div>

      {tab === "variables" ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-xs">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
              <Input className="pl-8" placeholder="Filter keys" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Filter keys" />
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => void toggleRevealAll()} disabled={!variables.length} isLoading={bulkBusy} title="Every revealed value is recorded in the activity log">
                {bulkBusy ? null : bulkValues ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                {bulkValues ? "Hide values" : "Reveal values"}
              </Button>
              <Button variant="secondary" onClick={() => setImportText("")}>
                <UploadIcon className="size-4" />
                Import .env
              </Button>
              <Button onClick={() => setAdding(true)} disabled={adding}>
                <PlusIcon className="size-4" />
                Add variable
              </Button>
            </div>
          </div>

          {bulkError ? <ErrorBanner error={bulkError} onDismiss={() => setBulkError(null)} /> : null}

          <Card>
            <div className="hidden grid-cols-[minmax(0,13rem)_minmax(0,1fr)_8.5rem_8.5rem_8.5rem_9rem] gap-x-3 border-b border-neutral-200 bg-neutral-50/70 px-4 py-2 text-xs font-medium text-neutral-500 lg:grid">
              <span>Key</span>
              <span>Value</span>
              <span>Added</span>
              <span>Modified</span>
              <span title="Last time the SDK, CLI or HTTP API returned this key">Last loaded</span>
              <span />
            </div>
            <ul className="divide-y divide-neutral-100">
              {adding ? (
                <li>
                  <VariableEditor
                    submitLabel="Add variable"
                    isSaving={create.isPending}
                    error={create.error}
                    onSubmit={(key, value) => create.mutate({ key, value })}
                    onCancel={() => {
                      create.reset();
                      setAdding(false);
                    }}
                    onPasteDotenv={(text) => {
                      setAdding(false);
                      setImportText(text);
                    }}
                  />
                </li>
              ) : null}
              {filtered.map((variable) => (
                <VariableRow key={variable.id} groupId={group.id} variable={variable} bulkValue={bulkValues?.[variable.id]} />
              ))}
            </ul>
            {variables.length === 0 && !adding ? (
              <EmptyState
                icon={<PlusIcon className="size-5" />}
                title="No variables yet"
                description="Add variables one at a time, or paste a whole .env file."
                action={
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setImportText("")}>
                      Import .env
                    </Button>
                    <Button onClick={() => setAdding(true)}>Add variable</Button>
                  </div>
                }
              />
            ) : null}
            {variables.length > 0 && filtered.length === 0 ? <p className="px-4 py-8 text-center text-[13px] text-neutral-500">No keys match “{search}”.</p> : null}
          </Card>

          {variables.length > 0 ? (
            <div className="flex items-center justify-end gap-1 text-xs text-neutral-500">
              Copy all as .env <CopyButton getText={exportDotenv} label="Copy all as .env (logged)" />
            </div>
          ) : null}
        </>
      ) : null}

      {tab === "activity" ? (
        <Card>
          <ActivityList
            events={activity.data?.events}
            isPending={activity.isPending}
            showGroup={false}
            empty={<EmptyState title="No changes yet" description="Creates, edits and deletes in this group show up here." />}
          />
        </Card>
      ) : null}

      {tab === "connect" ? <ConnectPanel group={group} /> : null}

      <ImportModal group={group} open={importText !== null} initialText={importText ?? ""} onClose={() => setImportText(null)} />
      <SettingsModal group={group} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

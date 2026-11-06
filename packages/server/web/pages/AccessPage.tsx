import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { api, type Group } from "../api";
import { EyeIcon, RobotIcon } from "../components/icons";
import { Button, Card, EmptyState, PageHeader, Skeleton, Tag } from "../components/ui";
import { formatDateTime, timeAgo } from "../format";

type PersonRow = {
  actor: string;
  actorKind: string;
  groupId: string | null;
  groupName: string | null;
  groupExists: boolean;
  key: string | null;
  views: number;
  copies: number;
  exports: number;
  ipCount: number;
  lastAt: number;
  lastIp: string | null;
  lastUserAgent: string | null;
  lastSource: string | null;
};

type MachineRow = {
  actor: string;
  groupId: string | null;
  groupName: string | null;
  loads: number;
  ipCount: number;
  lastAt: number;
  lastIp: string | null;
  keys: string[];
};

type AccessReport = {
  people: PersonRow[];
  machines: MachineRow[];
  totals: { people: number; keys: number; views: number; copies: number; loads: number };
  actors: string[];
};

const RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "0", label: "All time" },
];

const selectClass =
  "h-8 rounded-md border border-neutral-300 bg-white pl-2 pr-7 text-[13px] text-neutral-800 shadow-[0_1px_1px_rgba(15,23,42,0.04)] outline-none hover:border-neutral-400 focus:border-brand focus:ring-3 focus:ring-brand/15";

const lastActionLabel: Record<string, string> = {
  reveal: "viewed",
  copy: "copied",
  export: "exported",
  edit: "opened to edit",
  history: "viewed history",
  mcp: "read via MCP",
};

function Count({ n, tone }: { n: number; tone: "neutral" | "orange" }) {
  if (n === 0) return <span className="text-neutral-300">0</span>;
  return <span className={`font-medium tabular-nums ${tone === "orange" ? "text-orange-700" : "text-neutral-900"}`}>{n}</span>;
}

function GroupKey({ groupId, groupName, groupExists, k }: { groupId: string | null; groupName: string | null; groupExists: boolean; k?: string | null }) {
  return (
    <div className="min-w-0">
      {k ? <p className="truncate font-mono text-[13px] font-medium text-neutral-950">{k}</p> : null}
      {groupExists ? (
        <Link to={`/groups/${groupId}`} className="truncate font-mono text-xs text-neutral-500 hover:text-neutral-800 hover:underline">
          {groupName}
        </Link>
      ) : (
        <span className="truncate font-mono text-xs text-neutral-400 line-through">{groupName}</span>
      )}
    </div>
  );
}

function LastSeen({ at, ip, ipCount, userAgent }: { at: number; ip: string | null; ipCount: number; userAgent?: string | null }) {
  return (
    <div className="text-right leading-tight">
      <p className="text-xs text-neutral-600" title={formatDateTime(at)}>
        {timeAgo(at)}
      </p>
      {ip ? (
        <Link
          to={`/activity?ip=${encodeURIComponent(ip)}`}
          title={userAgent ? `${ip}\n${userAgent}` : ip}
          className="mt-0.5 inline-block font-mono text-[11px] text-neutral-400 hover:text-neutral-700 hover:underline"
        >
          {ip}
          {ipCount > 1 ? <span className="ml-1 font-sans text-neutral-400">+{ipCount - 1}</span> : null}
        </Link>
      ) : null}
    </div>
  );
}

export function AccessPage() {
  const [params, setParams] = useSearchParams();
  const days = params.get("days") ?? "30";
  const group = params.get("group") ?? "";
  const actor = params.get("actor") ?? "";
  const key = params.get("key") ?? "";

  const groups = useQuery({ queryKey: ["groups"], queryFn: () => api<{ groups: Group[] }>("/api/groups").then((r) => r.groups) });
  const report = useQuery({
    queryKey: ["activity", "access", days, group, actor, key],
    queryFn: () => {
      const search = new URLSearchParams({ days });
      if (group) search.set("group", group);
      if (actor) search.set("actor", actor);
      if (key) search.set("key", key);
      return api<AccessReport>(`/api/access?${search}`);
    },
  });

  function setFilter(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { replace: true });
  }

  const data = report.data;
  const filtered = Boolean(group || actor || key);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Access"
        description="Who has seen and copied which values, and which tokens loaded which groups. Each row is one person and one key."
      />

      <div className="flex flex-wrap items-center gap-2">
        <select className={selectClass} value={days} onChange={(e) => setFilter("days", e.target.value === "30" ? "" : e.target.value)} aria-label="Time range">
          {RANGES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <select className={selectClass} value={group} onChange={(e) => setFilter("group", e.target.value)} aria-label="Filter by group">
          <option value="">All groups</option>
          {groups.data?.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <select className={selectClass} value={actor} onChange={(e) => setFilter("actor", e.target.value)} aria-label="Filter by person or token">
          <option value="">Everyone</option>
          {data?.actors.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        {key ? (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-300 bg-neutral-50 pl-2.5 pr-1 text-[13px] text-neutral-700">
            Key <code className="font-mono text-neutral-900">{key}</code>
            <button type="button" aria-label="Clear key filter" className="grid size-6 place-items-center rounded text-neutral-400 hover:bg-neutral-200 hover:text-neutral-800" onClick={() => setFilter("key", "")}>
              ×
            </button>
          </span>
        ) : null}
        {filtered ? (
          <Button variant="ghost" size="sm" onClick={() => setParams(days === "30" ? {} : { days }, { replace: true })}>
            Clear filters
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(
          [
            ["People", data?.totals.people],
            ["Keys seen", data?.totals.keys],
            ["Times viewed", data?.totals.views],
            ["Times copied", data?.totals.copies],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-lg border border-neutral-200 bg-white px-4 py-3">
            <p className="text-[13px] font-medium text-neutral-500">{label}</p>
            {value === undefined ? <Skeleton className="mt-2 h-6 w-10" /> : <p className="mt-1 text-xl font-semibold tabular-nums text-neutral-950">{value}</p>}
          </div>
        ))}
      </div>

      <Card>
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-900">People</h2>
          <span className="text-xs text-neutral-500">Reveals, copies, edits and history views in the dashboard and MCP</span>
        </div>
        {report.isPending ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-48" />
          </div>
        ) : !data?.people.length ? (
          <EmptyState icon={<EyeIcon className="size-5" />} title="Nobody has viewed a value in this range" description="Revealing, copying or exporting a value shows up here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50/70 text-xs text-neutral-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Person</th>
                  <th className="px-4 py-2 font-medium">Key</th>
                  <th className="px-4 py-2 text-right font-medium">Viewed</th>
                  <th className="px-4 py-2 text-right font-medium">Copied</th>
                  <th className="px-4 py-2 font-medium">Last</th>
                  <th className="px-4 py-2 text-right font-medium">When · IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {data.people.map((row) => (
                  <tr key={`${row.actor}/${row.groupId}/${row.key}`} className="hover:bg-neutral-50/70">
                    <td className="px-4 py-2.5">
                      <button type="button" className="inline-flex items-center gap-1 text-left text-[13px] font-medium text-neutral-900 hover:underline" onClick={() => setFilter("actor", row.actor)}>
                        {row.actorKind !== "user" ? <RobotIcon className="size-3.5 text-violet-600" /> : null}
                        {row.actor}
                      </button>
                    </td>
                    <td className="px-4 py-2.5">
                      <button type="button" className="block max-w-full text-left" onClick={() => setFilter("key", row.key ?? "")} title="Show everyone who saw this key">
                        <GroupKey groupId={row.groupId} groupName={row.groupName} groupExists={row.groupExists} k={row.key} />
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Count n={row.views} tone="neutral" />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Count n={row.copies + row.exports} tone="orange" />
                      {row.exports ? <span className="ml-1 text-[11px] text-neutral-400">({row.exports} .env)</span> : null}
                    </td>
                    <td className="px-4 py-2.5 text-[13px] text-neutral-600">{lastActionLabel[row.lastSource ?? ""] ?? "viewed"}</td>
                    <td className="px-4 py-2.5">
                      <LastSeen at={row.lastAt} ip={row.lastIp} ipCount={row.ipCount} userAgent={row.lastUserAgent} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!key ? (
        <Card>
          <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-neutral-900">Machines</h2>
            <span className="text-xs text-neutral-500">SDK, CLI and HTTP loads by API token</span>
          </div>
          {report.isPending ? null : !data?.machines.length ? (
            <p className="px-4 py-6 text-center text-[13px] text-neutral-500">No token has loaded a group in this range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50/70 text-xs text-neutral-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Token</th>
                    <th className="px-4 py-2 font-medium">Group</th>
                    <th className="px-4 py-2 text-right font-medium">Loads</th>
                    <th className="px-4 py-2 font-medium">Keys received</th>
                    <th className="px-4 py-2 text-right font-medium">When · IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {data.machines.map((row) => (
                    <tr key={`${row.actor}/${row.groupId}`} className="hover:bg-neutral-50/70">
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-1 text-[13px] font-medium text-neutral-900">
                          <RobotIcon className="size-3.5 text-violet-600" />
                          {row.actor}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <GroupKey groupId={row.groupId} groupName={row.groupName} groupExists={Boolean(groups.data?.some((g) => g.id === row.groupId))} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Count n={row.loads} tone="neutral" />
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-[13px] text-neutral-600" title={row.keys.join(", ")}>
                          {row.keys.length} key{row.keys.length === 1 ? "" : "s"}
                        </span>{" "}
                        <Tag tone="violet">via SDK</Tag>
                      </td>
                      <td className="px-4 py-2.5">
                        <LastSeen at={row.lastAt} ip={row.lastIp} ipCount={row.ipCount} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}

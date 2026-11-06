import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { api, type ActivityPage as Page, type Group } from "../api";
import { ActivityList } from "../components/ActivityFeed";
import { ActivityIcon } from "../components/icons";
import { Button, Card, EmptyState, PageHeader } from "../components/ui";

const ACTIONS = [
  { value: "", label: "All activity" },
  { value: "changes", label: "Changes only" },
  { value: "views", label: "Views & SDK loads" },
  { value: "var.view", label: "Values viewed" },
  { value: "env.read", label: "SDK loads" },
  { value: "var", label: "All variable changes" },
  { value: "var.create", label: "Variables created" },
  { value: "var.update", label: "Variables edited" },
  { value: "var.delete", label: "Variables deleted" },
  { value: "group", label: "Group changes" },
  { value: "token", label: "Token changes" },
];

const selectClass =
  "h-8 rounded-md border border-neutral-300 bg-white pl-2 pr-7 text-[13px] text-neutral-800 shadow-[0_1px_1px_rgba(15,23,42,0.04)] outline-none hover:border-neutral-400 focus:border-brand focus:ring-3 focus:ring-brand/15";

export function ActivityPage() {
  const [params, setParams] = useSearchParams();
  const action = params.get("action") ?? "";
  const group = params.get("group") ?? "";
  const actor = params.get("actor") ?? "";
  const ip = params.get("ip") ?? "";

  const groups = useQuery({ queryKey: ["groups"], queryFn: () => api<{ groups: Group[] }>("/api/groups").then((r) => r.groups) });
  const feed = useInfiniteQuery({
    queryKey: ["activity", "feed", action, group, actor, ip],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams({ limit: "50" });
      if (action) search.set("action", action);
      if (group) search.set("group", group);
      if (actor) search.set("actor", actor);
      if (ip) search.set("ip", ip);
      if (pageParam) search.set("before", String(pageParam));
      return api<Page>(`/api/activity?${search}`);
    },
    getNextPageParam: (last) => last.nextCursor,
  });

  const events = feed.data?.pages.flatMap((p) => p.events);
  const actors = feed.data?.pages[0]?.actors ?? [];
  const filtered = Boolean(action || group || actor || ip);

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Activity"
        description="An append-only log of every change and every time a value is viewed, with the IP it came from. Expand an edit to see the value before and after."
      />

      <div className="flex flex-wrap items-center gap-2">
        <select className={selectClass} value={action} onChange={(e) => setFilter("action", e.target.value)} aria-label="Filter by change type">
          {ACTIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
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
          {actors.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        {ip ? (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-300 bg-neutral-50 pl-2.5 pr-1 text-[13px] text-neutral-700">
            IP <code className="font-mono text-neutral-900">{ip}</code>
            <button type="button" aria-label="Clear IP filter" className="grid size-6 place-items-center rounded text-neutral-400 hover:bg-neutral-200 hover:text-neutral-800" onClick={() => setFilter("ip", "")}>
              ×
            </button>
          </span>
        ) : null}
        {filtered ? (
          <Button variant="ghost" size="sm" onClick={() => setParams({}, { replace: true })}>
            Clear filters
          </Button>
        ) : null}
      </div>

      <Card>
        <ActivityList
          events={events}
          isPending={feed.isPending}
          empty={
            <EmptyState
              icon={<ActivityIcon className="size-5" />}
              title={filtered ? "Nothing matches these filters" : "No activity yet"}
              description={filtered ? undefined : "Changes to groups, variables and tokens are recorded here."}
            />
          }
        />
        {feed.hasNextPage ? (
          <div className="border-t border-neutral-100 px-4 py-3 text-center">
            <Button variant="secondary" size="sm" isLoading={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>
              Load older
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

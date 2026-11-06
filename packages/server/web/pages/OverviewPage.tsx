import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, type ActivityPage, type Stats } from "../api";
import { ActivityList } from "../components/ActivityFeed";
import { ActivityIcon } from "../components/icons";
import { Card, EmptyState, PageHeader, Skeleton } from "../components/ui";
import { localDayKey, pluralize } from "../format";

const SERIES = [
  { action: "var.create", label: "Created", color: "#059669" },
  { action: "var.update", label: "Edited", color: "#1968ad" },
  { action: "var.delete", label: "Deleted", color: "#ef4444" },
] as const;

type Day = { key: string; date: Date; counts: Record<string, number>; total: number };

function buildDays(daily: Stats["daily"], length = 30): Day[] {
  const days: Day[] = [];
  const today = new Date();
  for (let i = length - 1; i >= 0; i--) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    days.push({ key: localDayKey(date), date, counts: {}, total: 0 });
  }
  const byKey = new Map(days.map((d) => [d.key, d]));
  for (const row of daily) {
    const day = byKey.get(row.day);
    if (!day) continue;
    day.counts[row.action] = (day.counts[row.action] ?? 0) + row.n;
    day.total += row.n;
  }
  return days;
}

function niceMax(value: number): number {
  // Four gridline steps, each a "nice" number (1, 2, 2.5, 5 × 10^n).
  if (value <= 4) return 4;
  const rawStep = value / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * magnitude).find((s) => s >= rawStep)!;
  return Math.ceil(step) * 4;
}

const dayLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });

function ChangesChart({ daily }: { daily: Stats["daily"] }) {
  const days = useMemo(() => buildDays(daily), [daily]);
  const [hovered, setHovered] = useState<number | null>(null);
  const max = niceMax(Math.max(...days.map((d) => d.total), 1));
  const ticks = [0, 1, 2, 3, 4].map((i) => (max / 4) * i);
  const totals = SERIES.map((s) => days.reduce((sum, d) => sum + (d.counts[s.action] ?? 0), 0));
  const chartHeight = 168;
  const hoveredDay = hovered === null ? null : days[hovered]!;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-600" aria-hidden="true">
        {SERIES.map((s, i) => (
          <span key={s.action} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-sm" style={{ background: s.color }} />
            {s.label}
            <span className="tabular-nums text-neutral-400">{totals[i]}</span>
          </span>
        ))}
      </div>

      <div className="relative mt-4 flex gap-2">
        <div className="relative w-6 shrink-0 text-right text-[11px] tabular-nums text-neutral-400" style={{ height: chartHeight }} aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: chartHeight - (t / max) * chartHeight }}>
              {t}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height: chartHeight }} aria-hidden="true">
            {ticks.map((t) => (
              <div key={t} className="absolute inset-x-0 h-px bg-neutral-100" style={{ top: chartHeight - (t / max) * chartHeight }} />
            ))}
          </div>
          <div className="relative flex items-end" style={{ height: chartHeight }} onMouseLeave={() => setHovered(null)} role="img" aria-label="Variable changes per day for the last 30 days">
            {days.map((day, index) => (
              <div
                key={day.key}
                className="flex h-full flex-1 cursor-default items-end justify-center px-px"
                onMouseEnter={() => setHovered(index)}
              >
                <div className={`flex w-full max-w-6 flex-col-reverse gap-0.5 transition-opacity ${hovered !== null && hovered !== index ? "opacity-45" : ""}`}>
                  {day.total === 0 ? <div className="h-0.5 rounded-full bg-neutral-100" /> : null}
                  {SERIES.map((s) => {
                    const n = day.counts[s.action] ?? 0;
                    if (!n) return null;
                    return <div key={s.action} className="last:rounded-t-[4px]" style={{ height: Math.max((n / max) * chartHeight - 2, 2), background: s.color }} />;
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-neutral-400" aria-hidden="true">
            <span>{dayLabel.format(days[0]!.date)}</span>
            <span>{dayLabel.format(days[14]!.date)}</span>
            <span>Today</span>
          </div>

          {hoveredDay ? (
            <div
              className="pointer-events-none absolute top-0 z-10 w-40 -translate-x-1/2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs shadow-lg"
              style={{ left: `clamp(5rem, ${((hovered! + 0.5) / days.length) * 100}%, calc(100% - 5rem))` }}
            >
              <p className="font-medium text-neutral-900">{weekday.format(hoveredDay.date)}</p>
              <div className="mt-1.5 space-y-1">
                {SERIES.map((s) => (
                  <div key={s.action} className="flex items-center justify-between gap-3 text-neutral-600">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-sm" style={{ background: s.color }} />
                      {s.label}
                    </span>
                    <span className="tabular-nums text-neutral-900">{hoveredDay.counts[s.action] ?? 0}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <table className="sr-only">
        <caption>Variable changes per day</caption>
        <thead>
          <tr>
            <th>Day</th>
            {SERIES.map((s) => (
              <th key={s.action}>{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.key}>
              <td>{d.key}</td>
              {SERIES.map((s) => (
                <td key={s.action}>{d.counts[s.action] ?? 0}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatTile({ label, value, sub, to }: { label: string; value: number | undefined; sub?: string; to?: string }) {
  const body = (
    <>
      <p className="text-[13px] font-medium text-neutral-500">{label}</p>
      {value === undefined ? <Skeleton className="mt-2 h-7 w-14" /> : <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-neutral-950">{value.toLocaleString()}</p>}
      {sub ? <p className="mt-0.5 text-xs text-neutral-500">{sub}</p> : null}
    </>
  );
  return to ? (
    <Link to={to} className="block rounded-lg border border-neutral-200 bg-white px-4 py-3.5 outline-none transition-colors hover:border-neutral-300 hover:bg-neutral-50/60 focus-visible:ring-2 focus-visible:ring-fuchsia-600">
      {body}
    </Link>
  ) : (
    <div className="rounded-lg border border-neutral-200 bg-white px-4 py-3.5">{body}</div>
  );
}

export function OverviewPage() {
  const stats = useQuery({
    queryKey: ["stats"],
    queryFn: () => api<Stats>(`/api/stats?tz=${new Date().getTimezoneOffset()}`),
  });
  const recent = useQuery({ queryKey: ["activity", "recent"], queryFn: () => api<ActivityPage>("/api/activity?action=changes&limit=8") });
  const s = stats.data;
  const delta = s ? s.changes7d - s.changesPrev7d : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Overview" description="Every change to your environment variables, at a glance." />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile label="Env groups" value={s?.groups} to="/groups" />
        <StatTile label="Variables" value={s?.variables} sub={s ? `across ${pluralize(s.groups, "group")}` : undefined} />
        <StatTile
          label="Changes · 7 days"
          value={s?.changes7d}
          sub={s ? (delta === 0 ? "Same as the week before" : `${delta > 0 ? "+" : "−"}${Math.abs(delta)} vs the week before`) : undefined}
          to="/activity"
        />
        <StatTile
          label="Values viewed · 7 days"
          value={s?.views7d}
          sub={s ? `${pluralize(s.reads7d, "SDK load")}` : undefined}
          to="/activity?action=views"
        />
        <StatTile label="Active API tokens" value={s?.tokens} sub={s ? pluralize(s.users, "member") : undefined} to="/tokens" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <Card className="p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-neutral-900">Variable changes</h2>
            <span className="text-xs text-neutral-500">Last 30 days</span>
          </div>
          {s ? <ChangesChart daily={s.daily} /> : <Skeleton className="h-52 w-full" />}
        </Card>

        <div className="space-y-4">
          <Card>
            <h2 className="border-b border-neutral-100 px-4 py-3 text-sm font-semibold text-neutral-900">Most changed groups</h2>
            {s && s.topGroups.length === 0 ? <p className="px-4 py-4 text-[13px] text-neutral-500">No changes in the last 30 days.</p> : null}
            <ul className="py-1">
              {s?.topGroups.map((g) => (
                <li key={g.id}>
                  <Link to={`/groups/${g.id}`} className="flex items-center justify-between gap-3 px-4 py-1.5 text-[13px] hover:bg-neutral-50">
                    <span className="truncate font-mono text-neutral-800">{g.name}</span>
                    <span className="tabular-nums text-neutral-500">{g.changes}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <h2 className="border-b border-neutral-100 px-4 py-3 text-sm font-semibold text-neutral-900">Most active</h2>
            {s && s.topActors.length === 0 ? <p className="px-4 py-4 text-[13px] text-neutral-500">Nobody yet.</p> : null}
            <ul className="py-1">
              {s?.topActors.map((a) => (
                <li key={a.label}>
                  <Link to={`/activity?actor=${encodeURIComponent(a.label)}`} className="flex items-center justify-between gap-3 px-4 py-1.5 text-[13px] hover:bg-neutral-50">
                    <span className="truncate text-neutral-800">
                      {a.label}
                      {a.kind !== "user" ? <span className="ml-1.5 text-[11px] text-violet-600">token</span> : null}
                    </span>
                    <span className="tabular-nums text-neutral-500">{a.changes}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <Card>
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-900">Recent changes</h2>
          <Link to="/activity" className="text-xs font-medium text-brand hover:underline">
            View all
          </Link>
        </div>
        <ActivityList
          events={recent.data?.events}
          isPending={recent.isPending}
          compact
          empty={
            <EmptyState
              icon={<ActivityIcon className="size-5" />}
              title="No activity yet"
              description="Create an env group and add a variable. Every create, edit and delete shows up here."
              action={
                <Link to="/groups" className="text-sm font-medium text-brand hover:underline">
                  Go to env groups
                </Link>
              }
            />
          }
        />
      </Card>
    </div>
  );
}

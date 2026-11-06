import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, type AuditEvent } from "../api";
import { formatDateTime, timeAgo } from "../format";
import { CopyIcon, DownloadIcon, EyeIcon, EyeOffIcon, KeyIcon, PencilIcon, PlusIcon, RobotIcon, TrashIcon } from "./icons";
import { Skeleton, Spinner, Tag } from "./ui";

export const verbStyles = {
  create: { label: "Created", dot: "bg-emerald-500", badge: "bg-emerald-50 text-emerald-700 ring-emerald-600/15", icon: PlusIcon },
  update: { label: "Edited", dot: "bg-brand", badge: "bg-sky-50 text-sky-700 ring-sky-600/15", icon: PencilIcon },
  delete: { label: "Deleted", dot: "bg-red-500", badge: "bg-red-50 text-red-700 ring-red-600/15", icon: TrashIcon },
  revoke: { label: "Revoked", dot: "bg-red-500", badge: "bg-red-50 text-red-700 ring-red-600/15", icon: TrashIcon },
  copy: { label: "Copied", dot: "bg-orange-500", badge: "bg-orange-50 text-orange-700 ring-orange-600/20", icon: CopyIcon },
  view: { label: "Viewed", dot: "bg-amber-500", badge: "bg-amber-50 text-amber-700 ring-amber-600/15", icon: EyeIcon },
  read: { label: "Loaded", dot: "bg-violet-500", badge: "bg-violet-50 text-violet-700 ring-violet-600/15", icon: DownloadIcon },
} as const;



function verbOf(action: string, source?: unknown): keyof typeof verbStyles {
  if (action === "env.read") return "read";
  if (action === "var.view" && (source === "copy" || source === "export")) return "copy";
  return (action.split(".")[1] ?? "update") as keyof typeof verbStyles;
}

const Key = ({ children }: { children: ReactNode }) => (
  <code className="rounded bg-neutral-100 px-1 py-px font-mono text-[12.5px] font-medium text-neutral-900">{children}</code>
);

function GroupLink({ event, showGroup }: { event: AuditEvent; showGroup: boolean }) {
  if (!showGroup || !event.groupName) return null;
  return (
    <>
      {" in "}
      {event.action === "group.delete" ? (
        <span className="font-mono text-[12.5px] text-neutral-700">{event.groupName}</span>
      ) : (
        <Link to={`/groups/${event.groupId}`} className="font-mono text-[12.5px] font-medium text-neutral-800 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-600">
          {event.groupName}
        </Link>
      )}
    </>
  );
}

export function describeEvent(event: AuditEvent, showGroup = true): ReactNode {
  const meta = event.meta ?? {};
  switch (event.action) {
    case "var.create":
      return (
        <>
          added <Key>{event.key}</Key>
          <GroupLink event={event} showGroup={showGroup} />
        </>
      );
    case "var.update":
      if (meta.renamedFrom) {
        return (
          <>
            renamed <Key>{String(meta.renamedFrom)}</Key> to <Key>{event.key}</Key>
            {meta.valueChanged ? " and changed its value" : ""}
            <GroupLink event={event} showGroup={showGroup} />
          </>
        );
      }
      return (
        <>
          changed the value of <Key>{event.key}</Key>
          <GroupLink event={event} showGroup={showGroup} />
        </>
      );
    case "var.delete":
      return (
        <>
          deleted <Key>{event.key}</Key>
          <GroupLink event={event} showGroup={showGroup} />
        </>
      );
    case "group.create":
      return (
        <>
          created env group{" "}
          <Link to={`/groups/${event.groupId}`} className="font-mono text-[12.5px] font-medium underline decoration-neutral-300 underline-offset-2">
            {event.groupName}
          </Link>
        </>
      );
    case "group.update":
      return meta.renamedFrom ? (
        <>
          renamed env group <span className="font-mono text-[12.5px]">{String(meta.renamedFrom)}</span> to{" "}
          <Link to={`/groups/${event.groupId}`} className="font-mono text-[12.5px] font-medium underline decoration-neutral-300 underline-offset-2">
            {event.groupName}
          </Link>
        </>
      ) : (
        <>
          updated the description of <GroupLink event={event} showGroup />
        </>
      );
    case "group.delete": {
      const keys = Array.isArray(meta.keys) ? meta.keys : [];
      return (
        <>
          deleted env group <span className="font-mono text-[12.5px] font-medium line-through decoration-red-400">{event.groupName}</span>
          {keys.length ? ` and its ${keys.length} variable${keys.length === 1 ? "" : "s"}` : ""}
        </>
      );
    }
    case "var.view": {
      const source = String(meta.source);
      const verb =
        source === "copy" ? "copied" : source === "export" ? "exported" : source === "edit" ? "opened to edit" : source === "history" ? "viewed a past value of" : "viewed";
      return (
        <>
          {verb} <Key>{event.key}</Key>
          <GroupLink event={event} showGroup={showGroup} />
          {source === "export" ? (
            <>
              {" "}
              <Tag tone="amber">as .env</Tag>
            </>
          ) : null}
        </>
      );
    }
    case "env.read": {
      const keys = Array.isArray(meta.keys) ? meta.keys : [];
      return (
        <>
          loaded{" "}
          {showGroup && event.groupName ? (
            <Link to={`/groups/${event.groupId}`} className="font-mono text-[12.5px] font-medium text-neutral-800 underline decoration-neutral-300 underline-offset-2">
              {event.groupName}
            </Link>
          ) : (
            "this group"
          )}{" "}
          <span title={keys.join(", ")} className="cursor-help underline decoration-dotted decoration-neutral-300 underline-offset-2">
            ({keys.length} key{keys.length === 1 ? "" : "s"})
          </span>{" "}
          <Tag tone="violet">via SDK</Tag>
        </>
      );
    }
    case "token.create":
      return (
        <>
          created API token <span className="font-medium">{String(meta.name)}</span>{" "}
          <Tag tone={meta.access === "write" ? "amber" : "neutral"}>{meta.access === "write" ? "read/write" : "read-only"}</Tag>
        </>
      );
    case "token.revoke":
      return (
        <>
          revoked API token <span className="font-medium">{String(meta.name)}</span>
        </>
      );
    default:
      return event.action;
  }
}

function ValueDiff({ eventId, event }: { eventId: number; event: AuditEvent }) {
  const values = useQuery({
    queryKey: ["event-values", eventId],
    queryFn: () => api<{ oldValue: string | null; newValue: string | null }>(`/api/activity/${eventId}/values`, { method: "POST", body: {} }),
    // Every open is a fresh, audited view: no cache, no background refetch.
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
  if (values.isPending) {
    return (
      <div className="flex items-center gap-2 text-xs text-neutral-500">
        <Spinner className="size-3" /> Decrypting…
      </div>
    );
  }
  if (values.error) return <p className="text-xs text-red-700">Could not load values.</p>;
  const { oldValue, newValue } = values.data;
  const unchanged = event.action === "var.update" && oldValue === newValue;
  return (
    <div className="overflow-hidden rounded-md border border-neutral-200 font-mono text-[12.5px] leading-5">
      {oldValue !== null && !unchanged ? (
        <div className="flex gap-2 bg-red-50/70 px-3 py-1.5 text-red-900">
          <span className="select-none text-red-400">−</span>
          <span className="whitespace-pre-wrap break-all">{oldValue || <em className="text-red-400">empty</em>}</span>
        </div>
      ) : null}
      {newValue !== null ? (
        <div className={`flex gap-2 px-3 py-1.5 ${unchanged ? "bg-neutral-50 text-neutral-700" : "bg-emerald-50/70 text-emerald-900"}`}>
          <span className={`select-none ${unchanged ? "text-neutral-400" : "text-emerald-500"}`}>{unchanged ? " " : "+"}</span>
          <span className="whitespace-pre-wrap break-all">{newValue || <em className="text-emerald-500">empty</em>}</span>
        </div>
      ) : null}
    </div>
  );
}

export function ActivityRow({ event, showGroup = true, compact = false }: { event: AuditEvent; showGroup?: boolean; compact?: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const verb = verbStyles[verbOf(event.action, event.meta?.source)] ?? verbStyles.update;
  const VerbIcon = event.action.startsWith("token") ? KeyIcon : verb.icon;
  const hasValues = event.hasOldValue || event.hasNewValue;

  return (
    <li className={`group/row px-4 ${compact ? "py-2.5" : "py-3"}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ring-1 ring-inset ${verb.badge}`}>
          <VerbIcon className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] leading-6 text-neutral-700">
            <span className="inline-flex items-center gap-1 font-medium text-neutral-950">
              {event.actorKind !== "user" ? <RobotIcon className="size-3.5 text-violet-600" /> : null}
              {event.actorLabel}
            </span>{" "}
            {describeEvent(event, showGroup)}
            {event.actorKind === "mcp" ? (
              <>
                {" "}
                <Tag tone="violet">via MCP</Tag>
              </>
            ) : null}
          </p>
          {revealed ? (
            <div className="mt-2 max-w-2xl">
              <ValueDiff eventId={event.id} event={event} />
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {hasValues ? (
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              className={`inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-fuchsia-600 ${revealed ? "bg-neutral-100 text-neutral-800" : "text-neutral-400 opacity-0 hover:bg-neutral-100 hover:text-neutral-800 group-hover/row:opacity-100 focus-visible:opacity-100"}`}
            >
              {revealed ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
              {revealed ? "Hide" : event.action === "var.update" ? "Diff" : "Value"}
            </button>
          ) : null}
          <div className="w-32 text-right leading-tight">
            <time className="block text-xs tabular-nums text-neutral-500" dateTime={new Date(event.at).toISOString()} title={formatDateTime(event.at)}>
              {timeAgo(event.at)}
            </time>
            {event.ip ? (
              <Link
                to={`/activity?ip=${encodeURIComponent(event.ip)}`}
                title={event.userAgent ? `${event.ip}\n${event.userAgent}` : event.ip}
                className="mt-0.5 block truncate font-mono text-[11px] text-neutral-400 hover:text-neutral-700 hover:underline"
              >
                {event.ip}
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}

export function ActivityList({ events, isPending, showGroup = true, compact, empty }: { events?: AuditEvent[]; isPending: boolean; showGroup?: boolean; compact?: boolean; empty?: ReactNode }) {
  if (isPending) {
    return (
      <ul className="divide-y divide-neutral-100">
        {Array.from({ length: 4 }, (_, i) => (
          <li key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-6 rounded-full" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </li>
        ))}
      </ul>
    );
  }
  if (!events?.length) return <>{empty}</>;
  return (
    <ul className="divide-y divide-neutral-100">
      {events.map((event) => (
        <ActivityRow key={event.id} event={event} showGroup={showGroup} compact={compact} />
      ))}
    </ul>
  );
}

import { parseDotenv } from "./dotenv";
import { AppError, forbidden } from "./errors";
import { bearerToken, json } from "./http";
import type { ApiToken, Store } from "./store";

/**
 * Minimal MCP server over Streamable HTTP (stateless JSON responses).
 * Authenticate with an API token: `Authorization: Bearer se_...`.
 * Read tokens get read tools; write tokens can also change variables.
 */

const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

type JsonRpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, any> };

type Tool = {
  name: string;
  description: string;
  write?: boolean;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  run: (args: Record<string, any>, ctx: { store: Store; token: ApiToken; request: RequestContext }) => unknown;
};

const groupArg = { type: "string", description: "Env group name (e.g. backend-production) or id" };

export function canAccessGroup(token: ApiToken, groupId: string): boolean {
  return token.groupIds === null || token.groupIds.includes(groupId);
}

function requireGroup(store: Store, token: ApiToken, nameOrId: unknown) {
  if (typeof nameOrId !== "string" || !nameOrId) throw new AppError(400, "group is required");
  const group = store.getGroup(nameOrId);
  if (!canAccessGroup(token, group.id)) throw forbidden(`This token cannot access "${group.name}"`);
  return group;
}

type RequestContext = { ip: string | null; userAgent: string | null };

const actorFor = (token: ApiToken, request: RequestContext) => ({ id: token.id, label: token.name, kind: "mcp" as const, ...request });

const tools: Tool[] = [
  {
    name: "list_groups",
    description: "List the env groups this token can access, with variable counts.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    run: (_args, { store, token }) =>
      store.listGroups().filter((g) => canAccessGroup(token, g.id)).map(({ id, name, description, variableCount, updatedAt }) => ({
        id,
        name,
        description,
        variableCount,
        updatedAt: new Date(updatedAt).toISOString(),
      })),
  },
  {
    name: "get_variables",
    description:
      "List the variables in an env group. Values are hidden unless include_values is true; only reveal them when the user needs the actual values.",
    inputSchema: {
      type: "object",
      properties: {
        group: groupArg,
        include_values: { type: "boolean", description: "Return secret values instead of masking them", default: false },
      },
      required: ["group"],
    },
    annotations: { readOnlyHint: true },
    run: (args, { store, token, request }) => {
      const group = requireGroup(store, token, args.group);
      // Revealing values is audited exactly like a reveal in the dashboard.
      const values = args.include_values ? store.revealVariables(group.id, null, actorFor(token, request), "mcp") : null;
      return {
        group: group.name,
        variables: store.listVariableMeta(group.id).map((v) => ({
          key: v.key,
          value: values ? values[v.id] : `•••• (${v.valueLength} chars)`,
          updatedAt: new Date(v.updatedAt).toISOString(),
          updatedBy: v.updatedBy,
        })),
      };
    },
  },
  {
    name: "set_variable",
    description: "Create a variable or update its value in an env group. The change is recorded in the activity log.",
    write: true,
    inputSchema: {
      type: "object",
      properties: { group: groupArg, key: { type: "string" }, value: { type: "string" } },
      required: ["group", "key", "value"],
    },
    annotations: { destructiveHint: false, idempotentHint: true },
    run: (args, { store, token, request }) => {
      const group = requireGroup(store, token, args.group);
      const outcome = store.upsertVariable(group.id, { key: String(args.key ?? ""), value: String(args.value ?? "") }, actorFor(token, request));
      return { group: group.name, key: args.key, result: outcome };
    },
  },
  {
    name: "delete_variable",
    description: "Delete a variable from an env group. The old value is kept in the activity log.",
    write: true,
    inputSchema: { type: "object", properties: { group: groupArg, key: { type: "string" } }, required: ["group", "key"] },
    annotations: { destructiveHint: true },
    run: (args, { store, token, request }) => {
      const group = requireGroup(store, token, args.group);
      store.deleteVariable(group.id, String(args.key ?? ""), actorFor(token, request));
      return { group: group.name, key: args.key, result: "deleted" };
    },
  },
  {
    name: "import_dotenv",
    description: "Import KEY=value lines (.env format) into an env group.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        group: groupArg,
        content: { type: "string", description: ".env file contents" },
        overwrite: { type: "boolean", description: "Replace values of keys that already exist", default: true },
      },
      required: ["group", "content"],
    },
    run: (args, { store, token, request }) => {
      const group = requireGroup(store, token, args.group);
      const entries = parseDotenv(String(args.content ?? ""));
      return { group: group.name, ...store.importVariables(group.id, entries, args.overwrite !== false, actorFor(token, request)) };
    },
  },
  {
    name: "create_group",
    description: "Create a new, empty env group. Requires a write token that can access all groups.",
    write: true,
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" }, description: { type: "string" } },
      required: ["name"],
    },
    run: (args, { store, token, request }) => {
      if (token.groupIds !== null) throw forbidden("Only tokens with access to all groups can create groups");
      const group = store.createGroup({ name: String(args.name ?? ""), description: args.description }, actorFor(token, request));
      return { id: group.id, name: group.name };
    },
  },
  {
    name: "list_activity",
    description: "Recent changes (variable creates, edits and deletes, plus group and token changes). Never includes values.",
    inputSchema: {
      type: "object",
      properties: {
        group: { ...groupArg, description: "Only show changes for this group" },
        limit: { type: "number", default: 25, maximum: 100 },
      },
    },
    annotations: { readOnlyHint: true },
    run: (args, { store, token, request }) => {
      const group = args.group ? requireGroup(store, token, args.group) : null;
      const { events } = store.listEvents({ groupId: group?.id, limit: Math.min(Number(args.limit) || 25, 100) * (group ? 1 : 4) });
      return events
        .filter((e) => (e.groupId ? canAccessGroup(token, e.groupId) : token.groupIds === null))
        .slice(0, Math.min(Number(args.limit) || 25, 100))
        .map((e) => ({
          at: new Date(e.at).toISOString(),
          actor: e.actorLabel,
          action: e.action,
          group: e.groupName,
          key: e.key,
          ...(e.meta ? { details: e.meta } : {}),
        }));
    },
  },
];

function rpcResult(id: JsonRpcRequest["id"], result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: JsonRpcRequest["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function handleMessage(message: JsonRpcRequest, store: Store, token: ApiToken, request: RequestContext): object | null {
  const isNotification = message.id === undefined;
  if (message?.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return rpcError(message?.id, -32600, "Invalid request");
  }
  const available = tools.filter((t) => !t.write || token.access === "write");

  switch (message.method) {
    case "initialize": {
      const requested = message.params?.protocolVersion;
      return rpcResult(message.id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "secenv", version: "0.1.0" },
        instructions:
          "secenv stores environment variables in named env groups. Use list_groups first. " +
          "Avoid include_values unless the user asks for actual secret values.",
      });
    }
    case "ping":
      return rpcResult(message.id, {});
    case "tools/list":
      return rpcResult(message.id, {
        tools: available.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations })),
      });
    case "tools/call": {
      const name = message.params?.name;
      const tool = tools.find((t) => t.name === name);
      if (!tool) return rpcError(message.id, -32602, `Unknown tool: ${name}`);
      if (tool.write && token.access !== "write") {
        return rpcResult(message.id, {
          isError: true,
          content: [{ type: "text", text: "This API token is read-only. Create a read/write token to change variables." }],
        });
      }
      try {
        const output = tool.run(message.params?.arguments ?? {}, { store, token, request });
        return rpcResult(message.id, { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] });
      } catch (error) {
        const text = error instanceof AppError ? error.message : "Tool failed";
        if (!(error instanceof AppError)) console.error("[secenv] mcp tool error", error);
        return rpcResult(message.id, { isError: true, content: [{ type: "text", text }] });
      }
    }
    default:
      if (isNotification) return null; // notifications/initialized, cancelled, ...
      return rpcError(message.id, -32601, `Method not found: ${message.method}`);
  }
}

export async function handleMcp(req: Request, store: Store, request: RequestContext): Promise<Response> {
  if (req.method !== "POST") {
    return json({ error: "This MCP server is stateless; POST JSON-RPC messages to /mcp" }, 405, { Allow: "POST" });
  }
  const secret = bearerToken(req);
  const token = secret ? store.authenticateToken(secret) : null;
  if (!token) {
    return json(rpcError(null, -32001, "Missing or invalid API token. Send Authorization: Bearer se_..."), 401, {
      "WWW-Authenticate": 'Bearer realm="secenv"',
    });
  }

  const payload = await req.json().catch(() => undefined);
  if (payload === undefined) return json(rpcError(null, -32700, "Parse error"), 400);

  const messages: JsonRpcRequest[] = Array.isArray(payload) ? payload : [payload];
  const responses = messages.map((m) => handleMessage(m, store, token, request)).filter((r): r is object => r !== null);
  if (responses.length === 0) return new Response(null, { status: 202 });
  return json(Array.isArray(payload) ? responses : responses[0]);
}

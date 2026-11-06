import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer } from "../src/app";
import { parseConfig } from "../src/config";
import { parseDotenv } from "../src/dotenv";
import { fetchEnv, loadEnv, SecenvError } from "../../sdk/src/index";

const masterKey = "test-master-key-0123456789abcdef";

function makeServer(extra: Record<string, unknown> = {}) {
  const config = parseConfig({ server: { database: ":memory:", master_key: masterKey, port: 0 }, ...extra });
  return createServer(config, { port: 0 });
}

/** Tiny client that keeps the session cookie like a browser would. */
function browser(base: string) {
  let cookie = "";
  return async (path: string, init: { method?: string; body?: unknown; origin?: string } = {}) => {
    const res = await fetch(base + path, {
      method: init.method ?? "GET",
      redirect: "manual",
      headers: {
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(init.origin ? { Origin: init.origin } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const set = res.headers.getSetCookie().find((c) => c.startsWith("secenv_session="));
    if (set) cookie = set.split(";")[0]!;
    const text = await res.text();
    let data: any = text;
    try {
      data = JSON.parse(text);
    } catch {}
    return { status: res.status, data, headers: res.headers };
  };
}

describe("secenv server", () => {
  const { server } = makeServer();
  const base = server.url.origin;
  const alice = browser(base);
  let groupId = "";
  let readToken = "";
  let writeToken = "";

  afterAll(() => server.stop(true));

  test("first user can sign up, then sign-up closes", async () => {
    expect((await alice("/api/auth/config")).data).toMatchObject({ needsSetup: true, setupTokenRequired: false, password: { signupOpen: true } });
    const signup = await alice("/api/auth/signup", { method: "POST", body: { email: "Alice@Example.com", password: "correct horse battery" } });
    expect(signup.status).toBe(201);
    expect(signup.data.user.email).toBe("alice@example.com");

    const bob = browser(base);
    const second = await bob("/api/auth/signup", { method: "POST", body: { email: "bob@example.com", password: "another long password" } });
    expect(second.status).toBe(403);
    expect((await bob("/api/me")).status).toBe(401);
  });

  test("login checks the password", async () => {
    const other = browser(base);
    expect((await other("/api/auth/login", { method: "POST", body: { email: "alice@example.com", password: "nope nope nope" } })).status).toBe(401);
    expect((await other("/api/auth/login", { method: "POST", body: { email: "alice@example.com", password: "correct horse battery" } })).status).toBe(200);
    expect((await other("/api/me")).data.user.email).toBe("alice@example.com");
  });

  test("blocks cross-site mutations", async () => {
    const res = await alice("/api/groups", { method: "POST", body: { name: "evil" }, origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });

  test("group and variable lifecycle is audited", async () => {
    const created = await alice("/api/groups", { method: "POST", body: { name: "backend-prod", description: "API" } });
    expect(created.status).toBe(201);
    groupId = created.data.group.id;
    expect((await alice("/api/groups", { method: "POST", body: { name: "backend-prod" } })).status).toBe(409);
    expect((await alice("/api/groups", { method: "POST", body: { name: "has space" } })).status).toBe(400);

    const v = await alice(`/api/groups/${groupId}/variables`, { method: "POST", body: { key: "DATABASE_URL", value: "postgres://one" } });
    expect(v.status).toBe(201);
    const varId = v.data.variable.id;
    expect((await alice(`/api/groups/${groupId}/variables`, { method: "POST", body: { key: "1BAD", value: "x" } })).status).toBe(400);

    await alice(`/api/groups/${groupId}/variables/${varId}`, { method: "PATCH", body: { value: "postgres://two" } });
    await alice(`/api/groups/${groupId}/variables/${varId}`, { method: "PATCH", body: { key: "DB_URL" } });
    // A no-op edit must not create an event.
    await alice(`/api/groups/${groupId}/variables/${varId}`, { method: "PATCH", body: { value: "postgres://two" } });

    const imported = await alice(`/api/groups/${groupId}/import`, {
      method: "POST",
      body: { content: 'REDIS_URL=redis://x\nDB_URL="postgres://two"\nexport API_KEY=abc # comment\n' },
    });
    expect(imported.data.summary).toEqual({ created: 2, updated: 0, unchanged: 1, skipped: 0 });

    await alice(`/api/groups/${groupId}/variables/${varId}`, { method: "DELETE" });

    const detail = await alice(`/api/groups/${groupId}`);
    expect(detail.data.variables.map((x: any) => x.key)).toEqual(["API_KEY", "REDIS_URL"]);

    const activity = await alice(`/api/activity?group=${groupId}&action=changes`);
    const actions = activity.data.events.map((e: any) => e.action);
    expect(actions).toEqual(["var.delete", "var.create", "var.create", "var.update", "var.update", "var.create", "group.create"]);
    const rename = activity.data.events.find((e: any) => e.meta?.renamedFrom);
    expect(rename).toMatchObject({ key: "DB_URL", meta: { renamedFrom: "DATABASE_URL", valueChanged: false } });

    const edit = activity.data.events.find((e: any) => e.action === "var.update" && e.meta?.valueChanged);
    const values = await alice(`/api/activity/${edit.id}/values`, { method: "POST", body: {} });
    expect(values.data).toEqual({ oldValue: "postgres://one", newValue: "postgres://two" });
    // Looking at history is itself a logged view of that key.
    const historyView = (await alice(`/api/activity?action=var.view`)).data.events[0];
    expect(historyView).toMatchObject({ key: "DATABASE_URL", meta: { source: "history", eventId: edit.id }, ip: "127.0.0.1" });

    expect((await alice("/api/activity?action=var.delete")).data.events).toHaveLength(1);
  });

  test("group details never include values; reveals are logged per key with IP", async () => {
    const detail = await alice(`/api/groups/${groupId}`);
    expect(detail.data.variables[0].value).toBeUndefined();
    expect(detail.data.variables[0].valueLength).toBe(3);
    const [apiKey, redis] = detail.data.variables;

    const one = await alice(`/api/groups/${groupId}/variables/reveal`, { method: "POST", body: { ids: [apiKey.id], source: "copy" } });
    expect(one.data.values).toEqual({ [apiKey.id]: "abc" });
    const all = await alice(`/api/groups/${groupId}/variables/reveal`, { method: "POST", body: { source: "reveal" } });
    expect(all.data.values).toEqual({ [apiKey.id]: "abc", [redis.id]: "redis://x" });

    const views = (await alice(`/api/activity?group=${groupId}&action=var.view`)).data.events;
    expect(views.slice(0, 3).map((e: any) => `${e.key}:${e.meta.source}`)).toEqual(["REDIS_URL:reveal", "API_KEY:reveal", "API_KEY:copy"]);
    expect(views[0]).toMatchObject({ actorLabel: "alice@example.com", ip: "127.0.0.1" });
    expect(views[0].userAgent).toBeTruthy();

    // The access report answers "who saw / copied what".
    const access = (await alice(`/api/access?group=${groupId}&days=0`)).data;
    const row = (k: string) => access.people.find((r: any) => r.actor === "alice@example.com" && r.key === k);
    expect(row("API_KEY")).toMatchObject({ views: 1, copies: 1, exports: 0, lastSource: "reveal", lastIp: "127.0.0.1", ipCount: 1 });
    expect(row("REDIS_URL")).toMatchObject({ views: 1, copies: 0 });
    const byKey = (await alice(`/api/access?key=API_KEY&days=0`)).data;
    expect(byKey.people.every((r: any) => r.key === "API_KEY")).toBe(true);
    expect(byKey.machines).toEqual([]);

    // Reveals are POST-only and CSRF-checked like any other mutation.
    expect((await alice(`/api/groups/${groupId}/variables/reveal`, { method: "POST", body: {}, origin: "https://evil.example" })).status).toBe(403);
    expect((await alice(`/api/groups/${groupId}/variables/reveal`, { method: "POST", body: { ids: ["nope"] } })).status).toBe(404);
  });

  test("values are encrypted at rest", async () => {
    // Use the store of a fresh server to inspect raw rows.
    const { store: s, server: fresh } = makeServer();
    const actor = { id: null, label: "test", kind: "user" as const };
    const g = s.createGroup({ name: "raw" }, actor);
    s.createVariable(g.id, { key: "SECRET", value: "hunter2" }, actor);
    const row = s.db.query("SELECT value_enc FROM env_vars").get() as { value_enc: string };
    expect(row.value_enc.startsWith("v1.")).toBe(true);
    expect(row.value_enc).not.toContain("hunter2");
    expect(s.listVariables(g.id)[0]!.value).toBe("hunter2");
    fresh.stop(true);
  });

  test("stats summarise changes and count views separately", async () => {
    const stats = await alice("/api/stats?tz=0");
    expect(stats.data).toMatchObject({ groups: 1, variables: 2, users: 1, views7d: 4, reads7d: 0 });
    const total = stats.data.daily.reduce((n: number, d: any) => n + d.n, 0);
    expect(total).toBe(6);
  });

  test("tokens are scoped by group and access", async () => {
    await alice("/api/groups", { method: "POST", body: { name: "shared" } });
    const shared = (await alice("/api/groups/shared")).data.group;
    await alice(`/api/groups/${shared.id}/variables`, { method: "POST", body: { key: "API_KEY", value: "from-shared" } });
    await alice(`/api/groups/${shared.id}/variables`, { method: "POST", body: { key: "LOG_LEVEL", value: "info" } });

    const read = await alice("/api/tokens", { method: "POST", body: { name: "api", access: "read", groupIds: [groupId] } });
    expect(read.status).toBe(201);
    readToken = read.data.secret;
    expect(readToken.startsWith("se_")).toBe(true);
    const write = await alice("/api/tokens", { method: "POST", body: { name: "agent", access: "write", groupIds: null } });
    writeToken = write.data.secret;

    const ok = await fetch(`${base}/api/v1/env?groups=backend-prod`, { headers: { Authorization: `Bearer ${readToken}` } });
    expect((await ok.json()).variables).toEqual({ API_KEY: "abc", REDIS_URL: "redis://x" });
    const denied = await fetch(`${base}/api/v1/env?groups=shared`, { headers: { Authorization: `Bearer ${readToken}` } });
    expect(denied.status).toBe(403);
    const anon = await fetch(`${base}/api/v1/env?groups=shared`);
    expect(anon.status).toBe(401);

    const merged = await fetch(`${base}/api/v1/env?groups=shared,backend-prod&format=dotenv`, { headers: { Authorization: `Bearer ${writeToken}` } });
    expect(await merged.text()).toBe('API_KEY="abc"\nLOG_LEVEL="info"\nREDIS_URL="redis://x"\n');

    // Every SDK load is logged once per group, with the keys it handed out and the caller's IP.
    const reads = (await alice("/api/activity?action=env.read")).data.events;
    expect(reads.slice(0, 2).map((e: any) => [e.actorLabel, e.actorKind, e.groupName, e.meta.keys, e.ip])).toEqual([
      ["agent", "token", "backend-prod", ["API_KEY", "REDIS_URL"], "127.0.0.1"],
      ["agent", "token", "shared", ["API_KEY", "LOG_LEVEL"], "127.0.0.1"],
    ]);
    // Per-variable provenance: who added it, who changed it last, and which token last received it.
    const prodVars = (await alice("/api/groups/backend-prod")).data.variables;
    const sharedVars = (await alice("/api/groups/shared")).data.variables;
    const v = (list: any[], k: string) => list.find((x) => x.key === k);
    expect(v(prodVars, "API_KEY")).toMatchObject({ createdBy: "alice@example.com", updatedBy: "alice@example.com", lastLoadedBy: "agent" });
    expect(v(prodVars, "API_KEY").lastLoadedAt).toBeGreaterThan(0);
    expect(v(sharedVars, "LOG_LEVEL")).toMatchObject({ lastLoadedBy: "agent" });
    // shared's API_KEY was overridden by backend-prod in the merged load, so it was never delivered.
    expect(v(sharedVars, "API_KEY")).toMatchObject({ lastLoadedAt: null, lastLoadedBy: null });

    const machines = (await alice("/api/access?days=0")).data.machines;
    expect(machines.find((m: any) => m.actor === "agent" && m.groupName === "shared")).toMatchObject({ loads: 1, keys: ["API_KEY", "LOG_LEVEL"] });
    // A denied load is not recorded.
    expect(reads.some((e: any) => e.actorLabel === "api" && e.groupName === "shared")).toBe(false);
  });

  test("SDK loads env into a target without clobbering by default", async () => {
    const target: Record<string, string | undefined> = { REDIS_URL: "local" };
    const result = await loadEnv({ url: base, token: writeToken, groups: ["shared", "backend-prod"], target, required: ["API_KEY"] });
    expect(result.API_KEY).toBe("abc");
    expect(target.REDIS_URL).toBe("local");
    expect(target.LOG_LEVEL).toBe("info");

    await loadEnv({ url: base, token: writeToken, groups: "backend-prod", target, override: true });
    expect(target.REDIS_URL).toBe("redis://x");

    await expect(loadEnv({ url: base, token: writeToken, groups: ["shared"], target: {}, required: ["NOPE"] })).rejects.toThrow("NOPE");
    await expect(fetchEnv({ url: base, token: readToken, groups: ["shared"] })).rejects.toBeInstanceOf(SecenvError);
    await expect(fetchEnv({ url: base, token: "se_bad", groups: ["shared"] })).rejects.toThrow("invalid API token");
  });

  describe("MCP", () => {
    let nextId = 1;
    const rpc = async (token: string, method: string, params?: unknown) => {
      const res = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
      });
      return (await res.json()) as any;
    };
    const call = async (token: string, name: string, args: unknown) => {
      const result = (await rpc(token, "tools/call", { name, arguments: args })).result;
      return { ...result, data: result.isError ? result.content[0].text : JSON.parse(result.content[0].text) };
    };

    test("initialize and list tools by access level", async () => {
      const init = await rpc(readToken, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
      expect(init.result.protocolVersion).toBe("2025-06-18");
      expect(init.result.serverInfo.name).toBe("secenv");

      const notification = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${readToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      });
      expect(notification.status).toBe(202);

      const readTools = (await rpc(readToken, "tools/list")).result.tools.map((t: any) => t.name);
      expect(readTools).toEqual(["list_groups", "get_variables", "list_activity"]);
      const writeTools = (await rpc(writeToken, "tools/list")).result.tools.map((t: any) => t.name);
      expect(writeTools).toContain("set_variable");

      const unauth = await fetch(`${base}/mcp`, { method: "POST", body: "{}" });
      expect(unauth.status).toBe(401);
    });

    test("read tools respect scope and mask values", async () => {
      const groups = await call(readToken, "list_groups", {});
      expect(groups.data.map((g: any) => g.name)).toEqual(["backend-prod"]);
      const masked = await call(readToken, "get_variables", { group: "backend-prod" });
      expect(masked.data.variables[0].value).toContain("••••");
      const before = (await alice("/api/activity?action=var.view&actor=api")).data.events.length;
      expect(before).toBe(0);
      const revealed = await call(readToken, "get_variables", { group: "backend-prod", include_values: true });
      expect(revealed.data.variables[0]).toMatchObject({ key: "API_KEY", value: "abc" });
      const mcpViews = (await alice("/api/activity?action=var.view&actor=api")).data.events;
      expect(mcpViews.map((e: any) => `${e.actorKind}:${e.key}:${e.meta.source}`)).toEqual(["mcp:REDIS_URL:mcp", "mcp:API_KEY:mcp"]);
      const denied = await call(readToken, "get_variables", { group: "shared" });
      expect(denied.isError).toBe(true);
      const writeDenied = await call(readToken, "set_variable", { group: "backend-prod", key: "X", value: "1" });
      expect(writeDenied.isError).toBe(true);
    });

    test("write tools change variables and are audited as MCP", async () => {
      expect((await call(writeToken, "set_variable", { group: "shared", key: "FEATURE_X", value: "on" })).data.result).toBe("created");
      expect((await call(writeToken, "set_variable", { group: "shared", key: "FEATURE_X", value: "off" })).data.result).toBe("updated");
      const featureX = (await alice("/api/groups/shared")).data.variables.find((x: any) => x.key === "FEATURE_X");
      expect(featureX).toMatchObject({ createdBy: "agent", updatedBy: "agent" });
      expect(featureX.updatedAt).toBeGreaterThanOrEqual(featureX.createdAt);
      expect((await call(writeToken, "delete_variable", { group: "shared", key: "FEATURE_X" })).data.result).toBe("deleted");
      const created = await call(writeToken, "create_group", { name: "from-agent" });
      expect(created.data.name).toBe("from-agent");

      const activity = await alice("/api/activity?actor=agent&action=changes");
      expect(activity.data.events.map((e: any) => `${e.actorKind}:${e.action}`)).toEqual([
        "mcp:group.create",
        "mcp:var.delete",
        "mcp:var.update",
        "mcp:var.create",
      ]);
      const log = await call(writeToken, "list_activity", { group: "shared", limit: 3 });
      expect(log.data.map((e: any) => e.action)).toEqual(["var.delete", "var.update", "var.create"]);
      expect(JSON.stringify(log.data)).not.toContain("off");
    });
  });

  test("revoked tokens stop working and group delete is logged", async () => {
    const tokens = (await alice("/api/tokens")).data.tokens;
    const api = tokens.find((t: any) => t.name === "api");
    await alice(`/api/tokens/${api.id}`, { method: "DELETE" });
    const res = await fetch(`${base}/api/v1/env?groups=backend-prod`, { headers: { Authorization: `Bearer ${readToken}` } });
    expect(res.status).toBe(401);

    await alice(`/api/groups/${groupId}`, { method: "DELETE" });
    const events = (await alice("/api/activity?action=group.delete")).data.events;
    expect(events[0]).toMatchObject({ groupName: "backend-prod", meta: { keys: ["API_KEY", "REDIS_URL"] } });
  });
});

describe("setup token", () => {
  test("is required to create the first account when configured", async () => {
    const { server } = makeServer({ server: { database: ":memory:", master_key: masterKey, port: 0 }, auth: { setup_token: "let-me-in-123" } });
    const user = browser(server.url.origin);
    expect((await user("/api/auth/config")).data.setupTokenRequired).toBe(true);
    const body = { email: "first@example.com", password: "long enough password" };
    expect((await user("/api/auth/signup", { method: "POST", body })).status).toBe(403);
    expect((await user("/api/auth/signup", { method: "POST", body: { ...body, setupToken: "wrong" } })).status).toBe(403);
    expect((await user("/api/auth/signup", { method: "POST", body: { ...body, setupToken: "let-me-in-123" } })).status).toBe(201);
    expect((await user("/api/auth/config")).data.setupTokenRequired).toBe(false);
    server.stop(true);
  });
});

describe("client IP behind proxies", () => {
  const request = async (trusted: number, xff: string) => {
    const { server, store } = makeServer({ server: { database: ":memory:", master_key: masterKey, port: 0, trusted_proxies: trusted } });
    const res = await fetch(`${server.url.origin}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "ip@example.com", password: "long enough password" }),
    });
    const cookie = res.headers.getSetCookie()[0]!.split(";")[0]!;
    await fetch(`${server.url.origin}/api/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-Forwarded-For": xff },
      body: JSON.stringify({ name: "g" }),
    });
    const ip = store.listEvents({}).events[0]!.ip;
    server.stop(true);
    return ip;
  };

  test("ignores X-Forwarded-For unless proxies are trusted", async () => {
    expect(await request(0, "6.6.6.6")).toBe("127.0.0.1");
  });

  test("takes the entry added by the trusted proxy, not a spoofed one", async () => {
    // The client sent "6.6.6.6"; the proxy appended the real address.
    expect(await request(1, "6.6.6.6, 203.0.113.9")).toBe("203.0.113.9");
    expect(await request(2, "6.6.6.6, 198.51.100.7, 10.0.0.2")).toBe("198.51.100.7");
  });
});

describe("config", () => {
  test("requires at least one auth method", () => {
    expect(() => parseConfig({ auth: { password: { enabled: false } } })).toThrow("at least one");
  });

  test("interpolates environment variables", () => {
    process.env.TEST_OIDC_SECRET = "s3cret";
    const config = parseConfig({
      server: { database: ":memory:" },
      auth: { oidc: { enabled: true, issuer: "https://idp.example/", client_id: "abc", client_secret: "${TEST_OIDC_SECRET}" } },
    });
    expect(config.auth.oidc).toMatchObject({ issuer: "https://idp.example", clientSecret: "s3cret", scopes: ["openid", "email", "profile"] });
  });

  test("accepts env-style strings for booleans, numbers and lists", () => {
    const config = parseConfig({
      server: { database: ":memory:", trusted_proxies: "1" },
      auth: { allowed_email_domains: "a.com, b.com", password: { enabled: "true", allow_signup: "" }, oidc: { enabled: "false" } },
    });
    expect(config.trustedProxies).toBe(1);
    expect(config.auth.allowedEmailDomains).toEqual(["a.com", "b.com"]);
    expect(config.auth.password).toEqual({ enabled: true, allowSignup: false });
    expect(config.auth.oidc).toBeNull();
  });

  test("rejects OIDC without a client secret", () => {
    expect(() => parseConfig({ auth: { oidc: { enabled: true, issuer: "https://x", client_id: "a" } } })).toThrow("clientSecret");
  });
});

describe("dotenv parser", () => {
  test("handles quotes, comments, export and multi-line values", () => {
    const parsed = parseDotenv(`# comment
export A=1
B = "two words"
C='single #notcomment'
D=plain # trailing comment
E="line1\\nline2"
F="multi
line"
`);
    expect(Object.fromEntries(parsed.map((e) => [e.key, e.value]))).toEqual({
      A: "1",
      B: "two words",
      C: "single #notcomment",
      D: "plain",
      E: "line1\nline2",
      F: "multi\nline",
    });
  });

  test("reports bad lines", () => {
    expect(() => parseDotenv("GOOD=1\nnot a var")).toThrow("Line 2");
  });
});

describe("OIDC sign-in", () => {
  let idp: ReturnType<typeof Bun.serve>;
  let app: ReturnType<typeof makeServer>;
  let issuer = "";
  let lastAuthorize: URLSearchParams | null = null;

  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

  beforeAll(() => {
    idp = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname === "/.well-known/openid-configuration") {
          return Response.json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token` });
        }
        if (url.pathname === "/token") {
          const auth = req.headers.get("authorization");
          const body = new URLSearchParams(await req.text());
          if (auth !== `Basic ${btoa("client:secret")}` || body.get("code") !== "good-code" || !body.get("code_verifier")) {
            return Response.json({ error: "invalid_grant" }, { status: 400 });
          }
          const claims = {
            iss: issuer,
            aud: "client",
            sub: "user-42",
            email: "Carol@Corp.example",
            email_verified: true,
            name: "Carol",
            nonce: lastAuthorize!.get("nonce"),
            exp: Math.floor(Date.now() / 1000) + 300,
          };
          return Response.json({ id_token: `${b64({ alg: "RS256" })}.${b64(claims)}.sig`, access_token: "at" });
        }
        return new Response("not found", { status: 404 });
      },
    });
    issuer = idp.url.origin;
    app = makeServer({
      auth: {
        password: { enabled: false },
        allowed_email_domains: ["corp.example"],
        oidc: { enabled: true, display_name: "Corp SSO", issuer, client_id: "client", client_secret: "secret" },
      },
    });
  });

  afterAll(() => {
    idp.stop(true);
    app.server.stop(true);
  });

  test("full authorization code + PKCE round trip creates a user", async () => {
    const base = app.server.url.origin;
    const config = await (await fetch(`${base}/api/auth/config`)).json();
    expect(config).toEqual({ password: null, oidc: { name: "Corp SSO" }, needsSetup: true, setupTokenRequired: false });

    const start = await fetch(`${base}/api/auth/oidc/start`, { redirect: "manual" });
    expect(start.status).toBe(302);
    const location = new URL(start.headers.get("location")!);
    lastAuthorize = location.searchParams;
    expect(location.origin + location.pathname).toBe(`${issuer}/authorize`);
    expect(lastAuthorize.get("code_challenge_method")).toBe("S256");
    const stateCookie = start.headers.getSetCookie()[0]!.split(";")[0]!;
    const state = lastAuthorize.get("state")!;

    // Missing state cookie (login CSRF) is rejected.
    const csrf = await fetch(`${base}/api/auth/oidc/callback?state=${state}&code=good-code`, { redirect: "manual" });
    expect(csrf.headers.get("location")).toStartWith("/login?error=");

    const callback = await fetch(`${base}/api/auth/oidc/callback?state=${state}&code=good-code`, {
      redirect: "manual",
      headers: { Cookie: stateCookie },
    });
    expect(callback.headers.get("location")).toBe("/");
    const session = callback.headers.getSetCookie().find((c) => c.startsWith("secenv_session="))!.split(";")[0]!;
    const me = await (await fetch(`${base}/api/me`, { headers: { Cookie: session } })).json();
    expect(me.user).toMatchObject({ email: "carol@corp.example", name: "Carol" });

    // State is single use.
    const replay = await fetch(`${base}/api/auth/oidc/callback?state=${state}&code=good-code`, { redirect: "manual", headers: { Cookie: stateCookie } });
    expect(replay.headers.get("location")).toStartWith("/login?error=");
  });
});

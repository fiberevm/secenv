import type { HTMLBundle } from "bun";
import type { Config } from "./config";
import { Vault } from "./crypto";
import { openDatabase } from "./db";
import { parseDotenv } from "./dotenv";
import { AppError, badRequest, forbidden } from "./errors";
import { bearerToken, cookie, errorResponse, field, getCookie, json, optionalField, readBody } from "./http";
import { canAccessGroup, handleMcp } from "./mcp";
import { OidcClient } from "./oidc";
import { Store, type Actor, type User, type ViewSource } from "./store";

const SESSION_COOKIE = "secenv_session";
const OIDC_STATE_COOKIE = "secenv_oidc_state";

type Req = Request & { params: Record<string, string> };
type Srv = { requestIP(req: Request): { address: string } | null } | undefined;

export function createApp(config: Config) {
  const store = new Store(openDatabase(config.databasePath), new Vault(config.masterKey));
  const secure = config.publicUrl.startsWith("https://");
  const publicOrigin = new URL(config.publicUrl).origin;
  const oidc = config.auth.oidc ? new OidcClient(config.auth.oidc, `${config.publicUrl}/api/auth/oidc/callback`) : null;
  const loginFailures = new Map<string, { count: number; resetAt: number }>();
  const dummyHash = Bun.password.hash(crypto.randomUUID());

  // The socket address of each request, captured by the route wrappers below.
  const socketIps = new WeakMap<Request, string | null>();

  /**
   * Client IP for the audit log. With N trusted proxies, the Nth X-Forwarded-For entry from
   * the right is the address the outermost proxy saw; entries further left are client-supplied.
   */
  function clientIp(req: Request): string | null {
    if (config.trustedProxies > 0) {
      const hops = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const ip = hops[hops.length - config.trustedProxies];
      if (ip) return normalizeIp(ip);
    }
    return normalizeIp(socketIps.get(req) ?? null);
  }

  const requestContext = (req: Request) => ({ ip: clientIp(req), userAgent: req.headers.get("user-agent") });
  const userActor = (user: User, req: Request): Actor => ({ id: user.id, label: user.email, kind: "user", ...requestContext(req) });

  function emailAllowed(email: string): boolean {
    const domains = config.auth.allowedEmailDomains;
    if (domains.length === 0) return true;
    return domains.includes(email.split("@")[1]?.toLowerCase() ?? "");
  }

  function sessionCookie(token: string) {
    return cookie(SESSION_COOKIE, token, { maxAgeSeconds: config.auth.sessionTtlHours * 3600, secure });
  }

  function currentUser(req: Request): User | null {
    const token = getCookie(req, SESSION_COOKIE);
    return token ? store.getSessionUser(token) : null;
  }

  /** Cookie sessions + mutations: refuse cross-site requests (JSON bodies already force a CORS preflight). */
  function checkOrigin(req: Request) {
    const origin = req.headers.get("origin");
    if (!origin) return;
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    const originHost = new URL(origin).host;
    if (origin !== publicOrigin && originHost !== host) throw forbidden("Cross-site request blocked");
  }

  const handle =
    (fn: (req: Req) => Response | Promise<Response>) =>
    async (req: Req, server?: Srv): Promise<Response> => {
      socketIps.set(req, server?.requestIP(req)?.address ?? null);
      try {
        return await fn(req);
      } catch (error) {
        return errorResponse(error);
      }
    };

  /** A route that needs a signed-in user. */
  const authed = (fn: (req: Req, user: User) => Response | Promise<Response>) =>
    handle(async (req) => {
      if (req.method !== "GET") checkOrigin(req);
      const user = currentUser(req);
      if (!user) throw new AppError(401, "Sign in required");
      return fn(req, user);
    });

  function throttle(key: string) {
    const entry = loginFailures.get(key);
    if (entry && entry.resetAt > Date.now() && entry.count >= 10) {
      throw new AppError(429, "Too many failed attempts. Try again in a few minutes.");
    }
  }

  function noteFailure(key: string) {
    const now = Date.now();
    const entry = loginFailures.get(key);
    if (!entry || entry.resetAt < now) loginFailures.set(key, { count: 1, resetAt: now + 15 * 60_000 });
    else entry.count++;
  }

  const signupOpen = () => config.auth.password.enabled && (store.countUsers() === 0 || config.auth.password.allowSignup);

  const routes = {
    "/healthz": () => new Response("ok"),

    // ── Auth ────────────────────────────────────────────────────────
    "/api/auth/config": handle(() =>
      json({
        password: config.auth.password.enabled ? { signupOpen: signupOpen() } : null,
        oidc: config.auth.oidc ? { name: config.auth.oidc.displayName } : null,
        needsSetup: store.countUsers() === 0,
      }),
    ),

    "/api/auth/signup": {
      POST: handle(async (req) => {
        checkOrigin(req);
        if (!signupOpen()) throw forbidden("Sign-up is disabled. Ask an existing member to invite you.");
        const body = await readBody(req);
        const email = field(body, "email").trim().toLowerCase();
        const password = field(body, "password");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest("Enter a valid email address");
        if (!emailAllowed(email)) throw forbidden("That email domain is not allowed on this server");
        if (password.length < 10) throw badRequest("Use a password of at least 10 characters");
        const user = store.createUser({
          email,
          name: optionalField(body, "name"),
          passwordHash: await Bun.password.hash(password),
        });
        return json({ user }, 201, { "Set-Cookie": sessionCookie(store.createSession(user.id, config.auth.sessionTtlHours * 3600_000)) });
      }),
    },

    "/api/auth/login": {
      POST: handle(async (req) => {
        checkOrigin(req);
        if (!config.auth.password.enabled) throw forbidden("Password sign-in is disabled");
        const body = await readBody(req);
        const email = field(body, "email").trim().toLowerCase();
        const password = field(body, "password");
        throttle(email);
        const user = store.findUserByEmail(email);
        // Always run a verify so response timing does not reveal which emails exist.
        const verified = await Bun.password.verify(password, user?.passwordHash ?? (await dummyHash));
        const ok = verified && Boolean(user?.passwordHash);
        if (!user || !ok) {
          noteFailure(email);
          throw new AppError(401, "Email or password is incorrect");
        }
        loginFailures.delete(email);
        return json({ user }, 200, { "Set-Cookie": sessionCookie(store.createSession(user.id, config.auth.sessionTtlHours * 3600_000)) });
      }),
    },

    "/api/auth/logout": {
      POST: handle((req) => {
        const token = getCookie(req, SESSION_COOKIE);
        if (token) store.deleteSession(token);
        return json({ ok: true }, 200, { "Set-Cookie": cookie(SESSION_COOKIE, "", { maxAgeSeconds: 0, secure }) });
      }),
    },

    "/api/auth/oidc/start": handle(async () => {
      if (!oidc) throw new AppError(404, "SSO is not configured");
      const { url, state } = await oidc.start();
      return new Response(null, {
        status: 302,
        headers: {
          Location: url,
          "Set-Cookie": cookie(OIDC_STATE_COOKIE, state, { maxAgeSeconds: 600, secure, path: "/api/auth/oidc" }),
        },
      });
    }),

    "/api/auth/oidc/callback": async (req: Req) => {
      const fail = (message: string) =>
        new Response(null, { status: 302, headers: { Location: `/login?error=${encodeURIComponent(message)}` } });
      try {
        if (!oidc || !config.auth.oidc) return fail("SSO is not configured");
        const url = new URL(req.url);
        const error = url.searchParams.get("error");
        if (error) return fail(url.searchParams.get("error_description") ?? error);
        const state = url.searchParams.get("state") ?? "";
        const code = url.searchParams.get("code") ?? "";
        // The state must match the cookie set on this browser, which blocks login CSRF.
        if (!state || state !== getCookie(req, OIDC_STATE_COOKIE)) return fail("Sign-in expired. Please try again.");

        const identity = await oidc.finish(state, code);
        if (config.auth.oidc.requireVerifiedEmail && !identity.emailVerified) return fail("Your email address is not verified");
        if (!emailAllowed(identity.email)) return fail("That email domain is not allowed on this server");

        let user = store.findUserByOidcSubject(identity.subject);
        if (!user) {
          const existing = store.findUserByEmail(identity.email);
          if (existing) {
            store.linkOidcSubject(existing.id, identity.subject, identity.name);
            user = existing;
          } else if (config.auth.oidc.autoCreateUsers || store.countUsers() === 0) {
            user = store.createUser({ email: identity.email, name: identity.name, oidcSubject: identity.subject });
          } else {
            return fail("No account exists for this email. Ask an admin to add you.");
          }
        }
        const headers = new Headers({ Location: "/" });
        headers.append("Set-Cookie", sessionCookie(store.createSession(user.id, config.auth.sessionTtlHours * 3600_000)));
        headers.append("Set-Cookie", cookie(OIDC_STATE_COOKIE, "", { maxAgeSeconds: 0, secure, path: "/api/auth/oidc" }));
        return new Response(null, { status: 302, headers });
      } catch (error) {
        if (!(error instanceof AppError)) console.error("[secenv] oidc callback failed", error);
        return fail(error instanceof AppError ? error.message : "Sign-in failed");
      }
    },

    "/api/me": authed((_req, user) => json({ user })),

    "/api/users": authed(() => json({ users: store.listUsers() })),

    // ── Groups & variables ──────────────────────────────────────────
    "/api/groups": {
      GET: authed(() => json({ groups: store.listGroups() })),
      POST: authed(async (req, user) => {
        const body = await readBody(req);
        const group = store.createGroup({ name: field(body, "name"), description: optionalField(body, "description") }, userActor(user, req));
        return json({ group }, 201);
      }),
    },

    "/api/groups/:id": {
      GET: authed((req) => {
        const group = store.getGroup(req.params.id!);
        return json({ group, variables: store.listVariableMeta(group.id) });
      }),
      PATCH: authed(async (req, user) => {
        const body = await readBody(req);
        const group = store.updateGroup(
          req.params.id!,
          { name: optionalField(body, "name"), description: optionalField(body, "description") },
          userActor(user, req),
        );
        return json({ group });
      }),
      DELETE: authed((req, user) => {
        store.deleteGroup(req.params.id!, userActor(user, req));
        return json({ ok: true });
      }),
    },

    "/api/groups/:id/variables": {
      POST: authed(async (req, user) => {
        const body = await readBody(req);
        const variable = store.createVariable(req.params.id!, { key: field(body, "key"), value: field(body, "value") }, userActor(user, req));
        return json({ variable }, 201);
      }),
    },

    // Values are only handed out here, and every one handed out is logged as a view.
    "/api/groups/:id/variables/reveal": {
      POST: authed(async (req, user) => {
        const body = await readBody(req);
        const ids = body.ids === undefined || body.ids === null ? null : body.ids;
        if (ids !== null && (!Array.isArray(ids) || ids.some((id) => typeof id !== "string"))) {
          throw badRequest("ids must be a list of variable ids, or omitted for every variable");
        }
        const source = ["reveal", "copy", "edit", "export"].includes(body.source as string) ? (body.source as ViewSource) : "reveal";
        return json({ values: store.revealVariables(req.params.id!, ids as string[] | null, userActor(user, req), source) });
      }),
    },

    "/api/groups/:id/variables/:variableId": {
      PATCH: authed(async (req, user) => {
        const body = await readBody(req);
        const variable = store.updateVariable(
          req.params.id!,
          req.params.variableId!,
          { key: optionalField(body, "key"), value: optionalField(body, "value") },
          userActor(user, req),
        );
        return json({ variable });
      }),
      DELETE: authed((req, user) => {
        store.deleteVariable(req.params.id!, req.params.variableId!, userActor(user, req));
        return json({ ok: true });
      }),
    },

    "/api/groups/:id/import": {
      POST: authed(async (req, user) => {
        const body = await readBody(req);
        let entries;
        try {
          entries = parseDotenv(field(body, "content"));
        } catch (error) {
          throw badRequest((error as Error).message);
        }
        if (entries.length === 0) throw badRequest("No KEY=value lines found");
        const summary = store.importVariables(req.params.id!, entries, body.overwrite !== false, userActor(user, req));
        return json({ summary });
      }),
    },

    // ── Activity & dashboard ────────────────────────────────────────
    "/api/activity": authed((req) => {
      const url = new URL(req.url);
      const params = url.searchParams;
      return json({
        ...store.listEvents({
          groupId: params.get("group") ?? undefined,
          action: params.get("action") ?? undefined,
          ip: params.get("ip") ?? undefined,
          actor: params.get("actor") ?? undefined,
          before: params.get("before") ? Number(params.get("before")) : undefined,
          limit: params.get("limit") ? Number(params.get("limit")) : undefined,
        }),
        actors: store.listActors(),
      });
    }),

    "/api/activity/:id/values": {
      POST: authed((req, user) => json(store.getEventValues(Number(req.params.id), userActor(user, req)))),
    },

    "/api/stats": authed((req) => {
      const tz = Number(new URL(req.url).searchParams.get("tz") ?? 0);
      return json(store.stats(Number.isFinite(tz) ? tz : 0));
    }),

    // ── API tokens ──────────────────────────────────────────────────
    "/api/tokens": {
      GET: authed(() => json({ tokens: store.listTokens() })),
      POST: authed(async (req, user) => {
        const body = await readBody(req);
        const groupIds = body.groupIds === null || body.groupIds === undefined ? null : body.groupIds;
        if (groupIds !== null && (!Array.isArray(groupIds) || groupIds.some((g) => typeof g !== "string"))) {
          throw badRequest("groupIds must be a list of group ids, or null for all groups");
        }
        const access = body.access === "write" ? "write" : "read";
        const result = store.createToken({ name: field(body, "name"), access, groupIds: groupIds as string[] | null }, userActor(user, req));
        return json(result, 201);
      }),
    },

    "/api/tokens/:id": {
      DELETE: authed((req, user) => {
        store.revokeToken(req.params.id!, userActor(user, req));
        return json({ ok: true });
      }),
    },

    // ── SDK & MCP (token auth) ──────────────────────────────────────
    "/api/v1/env": handle((req) => {
      const secret = bearerToken(req);
      const token = secret ? store.authenticateToken(secret) : null;
      if (!token) throw new AppError(401, "Missing or invalid API token");
      const url = new URL(req.url);
      const names = (url.searchParams.get("groups") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (names.length === 0) throw badRequest("Pass ?groups=name[,name...]");
      const groups = names.map((name) => {
        const group = store.getGroup(name);
        if (!canAccessGroup(token, group.id)) throw forbidden(`This token cannot read "${group.name}"`);
        return group;
      });
      const variables = store.resolveEnv(groups.map((g) => g.id));
      store.recordEnvRead(groups, { id: token.id, label: token.name, kind: "token", ...requestContext(req) }, "sdk");

      if (url.searchParams.get("format") === "dotenv") {
        const text = Object.entries(variables)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join("\n");
        return new Response(text + "\n", { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
      }
      return json({
        variables,
        groups: groups.map((g) => ({ name: g.name, updatedAt: g.updatedAt, variableCount: g.variableCount })),
      });
    }),

    "/mcp": (req: Req, server?: Srv) => {
      socketIps.set(req, server?.requestIP(req)?.address ?? null);
      return handleMcp(req, store, requestContext(req)).catch(errorResponse);
    },
  };

  return { store, routes };
}

export function createServer(config: Config, options: { ui?: HTMLBundle; port?: number; development?: boolean | { hmr?: boolean; console?: boolean } } = {}) {
  const { store, routes } = createApp(config);
  const server = Bun.serve({
    port: options.port ?? config.port,
    hostname: config.host,
    routes: {
      ...routes,
      "/api/*": () => json({ error: "Not found" }, 404),
      ...(options.ui ? { "/*": options.ui } : {}),
    } as any,
    fetch: () => json({ error: "Not found" }, 404),
    development: options.development ?? false,
  });
  return { server, store };
}

function normalizeIp(ip: string | null): string | null {
  if (!ip) return null;
  // IPv4 clients on a dual-stack socket show up as ::ffff:1.2.3.4.
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

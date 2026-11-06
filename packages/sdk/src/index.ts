/**
 * @secenv/sdk: load environment variables from a secenv server.
 *
 *   import { loadEnv } from "@secenv/sdk";
 *   await loadEnv({ groups: ["backend-production"] });
 *
 * Configuration falls back to SECENV_URL, SECENV_TOKEN and SECENV_GROUPS.
 */

export type ClientOptions = {
  /** Server URL, e.g. https://secenv.example.com. Defaults to SECENV_URL. */
  url?: string;
  /** API token (se_...). Defaults to SECENV_TOKEN. */
  token?: string;
  /** Request timeout per attempt. Default 10s. */
  timeoutMs?: number;
  /** Extra attempts on network errors and 5xx responses. Default 2. */
  retries?: number;
  /** Custom fetch (tests, proxies). Defaults to the global fetch. */
  fetch?: typeof fetch;
};

export type FetchOptions = ClientOptions & {
  /** Env group names, merged in order (later groups win). Defaults to SECENV_GROUPS (comma separated). */
  groups?: string[] | string;
};

export type LoadEnvOptions<K extends string> = FetchOptions & {
  /** Overwrite variables that are already set in the target. Default false, so the local environment wins. */
  override?: boolean;
  /** Keys that must exist after loading; throws a SecenvError listing any that are missing. */
  required?: readonly K[];
  /** Where to write the variables. Defaults to process.env. */
  target?: Record<string, string | undefined>;
};

export type EnvResponse = {
  variables: Record<string, string>;
  groups: Array<{ name: string; updatedAt: number; variableCount: number }>;
};

export class SecenvError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SecenvError";
  }
}

const env = (name: string): string | undefined => (typeof process !== "undefined" ? process.env[name] : undefined);

function resolveGroups(groups: FetchOptions["groups"]): string[] {
  const list = typeof groups === "string" ? groups.split(",") : (groups ?? env("SECENV_GROUPS")?.split(",") ?? []);
  const cleaned = list.map((g) => g.trim()).filter(Boolean);
  if (cleaned.length === 0) throw new SecenvError("No env groups given. Pass { groups: [...] } or set SECENV_GROUPS.");
  return cleaned;
}

export function createClient(options: ClientOptions = {}) {
  const url = (options.url ?? env("SECENV_URL"))?.replace(/\/+$/, "");
  const token = options.token ?? env("SECENV_TOKEN");
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const retries = options.retries ?? 2;

  if (!url) throw new SecenvError("Missing secenv URL. Pass { url } or set SECENV_URL.");
  if (!token) throw new SecenvError("Missing secenv token. Pass { token } or set SECENV_TOKEN.");
  if (!doFetch) throw new SecenvError("No fetch implementation available. Use Node 18+ or pass { fetch }.");

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 250 * 2 ** (attempt - 1)));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await doFetch(`${url}${path}`, {
          ...init,
          signal: controller.signal,
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...init.headers },
        });
        if (res.status >= 500 && attempt < retries) {
          lastError = new SecenvError(`secenv returned HTTP ${res.status}`, res.status);
          continue;
        }
        return res;
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timer);
      }
    }
    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    throw new SecenvError(`Could not reach secenv at ${url}: ${reason}`);
  }

  return {
    url,
    /** Fetch and merge the given groups without touching process.env. */
    async getEnv(groups?: FetchOptions["groups"]): Promise<EnvResponse> {
      const names = resolveGroups(groups);
      const res = await request(`/api/v1/env?groups=${encodeURIComponent(names.join(","))}`);
      const body = (await res.json().catch(() => ({}))) as Partial<EnvResponse> & { error?: string };
      if (!res.ok) throw new SecenvError(body.error ?? `secenv returned HTTP ${res.status}`, res.status);
      return { variables: body.variables ?? {}, groups: body.groups ?? [] };
    },
    /** Low-level access for other endpoints (used by the CLI's MCP bridge). */
    request,
  };
}

/** Fetch variables for the given groups. Does not modify process.env. */
export async function fetchEnv(options: FetchOptions = {}): Promise<Record<string, string>> {
  const { variables } = await createClient(options).getEnv(options.groups);
  return variables;
}

/**
 * Fetch variables and write them into process.env (or `target`).
 * Returns the merged view, typed so `required` keys are known to be strings.
 */
export async function loadEnv<K extends string = never>(
  options: LoadEnvOptions<K> = {},
): Promise<Record<K, string> & Record<string, string | undefined>> {
  const target = options.target ?? (process.env as Record<string, string | undefined>);
  const variables = await fetchEnv(options);

  for (const [key, value] of Object.entries(variables)) {
    if (options.override || target[key] === undefined) target[key] = value;
  }

  const missing = (options.required ?? []).filter((key) => target[key] === undefined || target[key] === "");
  if (missing.length) {
    throw new SecenvError(`Missing required environment variables: ${missing.join(", ")}`);
  }
  return target as Record<K, string> & Record<string, string | undefined>;
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { randomBytes } from "node:crypto";

export type OidcConfig = {
  displayName: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  tokenAuthMethod: "client_secret_basic" | "client_secret_post";
  autoCreateUsers: boolean;
  requireVerifiedEmail: boolean;
};

export type Config = {
  port: number;
  host: string;
  publicUrl: string;
  /** How many reverse proxies sit in front of secenv; their X-Forwarded-For entries are trusted. */
  trustedProxies: number;
  databasePath: string;
  masterKey: string;
  auth: {
    password: { enabled: boolean; allowSignup: boolean };
    oidc: OidcConfig | null;
    allowedEmailDomains: string[];
    sessionTtlHours: number;
    /** If set, creating the very first account requires this token (protects fresh public deploys). */
    setupToken: string;
  };
};

type Raw = Record<string, unknown>;

/** Replace `${NAME}` with the environment variable so secrets stay out of the file. */
function interpolate(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_, name: string) => process.env[name] ?? "");
  }
  if (Array.isArray(value)) return value.map(interpolate);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolate(v)]));
  }
  return value;
}

function section(raw: Raw, key: string): Raw {
  const value = raw[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : {};
}

function str(raw: Raw, key: string, fallback: string): string {
  const value = raw[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") throw new Error(`config: "${key}" must be a string`);
  return value;
}

function bool(raw: Raw, key: string, fallback: boolean): boolean {
  const value = raw[key];
  if (value === undefined || value === "") return fallback;
  if (typeof value === "boolean") return value;
  // "${ENV}" interpolation yields strings, so accept the usual spellings.
  if (typeof value === "string" && /^(true|1|yes|on)$/i.test(value.trim())) return true;
  if (typeof value === "string" && /^(false|0|no|off)$/i.test(value.trim())) return false;
  throw new Error(`config: "${key}" must be true or false`);
}

function num(raw: Raw, key: string, fallback: number): number {
  const value = raw[key];
  if (value === undefined || value === "") return fallback;
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) throw new Error(`config: "${key}" must be a number`);
  return parsed;
}

function strList(raw: Raw, key: string, fallback: string[]): string[] {
  const value = raw[key];
  if (value === undefined) return fallback;
  // A comma-separated string (e.g. from "${ALLOWED_DOMAINS}") is accepted as a list.
  if (typeof value === "string") return value.split(",").map((v) => v.trim()).filter(Boolean);
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new Error(`config: "${key}" must be a list of strings`);
  }
  return value as string[];
}

/** Build a Config from a parsed config document. Exported so tests can skip the file. */
export function parseConfig(input: Raw, baseDir = process.cwd()): Config {
  const raw = interpolate(input) as Raw;
  const server = section(raw, "server");
  const auth = section(raw, "auth");
  const password = section(auth, "password");
  const oidc = section(auth, "oidc");

  const port = process.env.PORT ? Number(process.env.PORT) : num(server, "port", 4400);
  const databaseSetting = str(server, "database", "./data/secenv.db");
  const databasePath = databaseSetting === ":memory:" ? databaseSetting : resolve(baseDir, databaseSetting);

  let oidcConfig: OidcConfig | null = null;
  if (bool(oidc, "enabled", false)) {
    const method = str(oidc, "token_auth_method", "") || "client_secret_basic";
    if (method !== "client_secret_basic" && method !== "client_secret_post") {
      throw new Error('config: auth.oidc.token_auth_method must be "client_secret_basic" or "client_secret_post"');
    }
    oidcConfig = {
      displayName: str(oidc, "display_name", "") || "SSO",
      issuer: str(oidc, "issuer", "").replace(/\/+$/, ""),
      clientId: str(oidc, "client_id", ""),
      clientSecret: str(oidc, "client_secret", ""),
      scopes: strList(oidc, "scopes", ["openid", "email", "profile"]),
      tokenAuthMethod: method,
      autoCreateUsers: bool(oidc, "auto_create_users", true),
      requireVerifiedEmail: bool(oidc, "require_verified_email", true),
    };
    for (const field of ["issuer", "clientId", "clientSecret"] as const) {
      if (!oidcConfig[field]) throw new Error(`config: auth.oidc is enabled but ${field} is empty`);
    }
  }

  const config: Config = {
    port,
    host: str(server, "host", "0.0.0.0"),
    // Render sets RENDER_EXTERNAL_URL to the service's public https URL.
    publicUrl: (str(server, "public_url", "") || process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`).replace(/\/+$/, ""),
    trustedProxies: Math.max(0, Math.floor(num(server, "trusted_proxies", 0))),
    databasePath,
    masterKey: str(server, "master_key", ""),
    auth: {
      password: {
        enabled: bool(password, "enabled", true),
        allowSignup: bool(password, "allow_signup", false),
      },
      oidc: oidcConfig,
      allowedEmailDomains: strList(auth, "allowed_email_domains", []).map((d) => d.toLowerCase()),
      sessionTtlHours: num(auth, "session_ttl_hours", 24 * 7),
      setupToken: str(auth, "setup_token", ""),
    },
  };

  if (!config.auth.password.enabled && !config.auth.oidc) {
    throw new Error("config: enable at least one of auth.password or auth.oidc");
  }
  return config;
}

/** Load `secenv.toml` (or the file named by SECENV_CONFIG). Missing file means defaults. */
export function loadConfig(path = process.env.SECENV_CONFIG ?? "secenv.toml"): Config {
  const fullPath = resolve(path);
  let raw: Raw = {};
  if (existsSync(fullPath)) {
    const text = readFileSync(fullPath, "utf8");
    raw = (extname(fullPath) === ".json" ? JSON.parse(text) : Bun.TOML.parse(text)) as Raw;
    console.log(`[secenv] loaded config from ${fullPath}`);
  } else if (process.env.SECENV_CONFIG) {
    throw new Error(`config file not found: ${fullPath}`);
  } else {
    console.warn(`[secenv] no ${path} found, using defaults (email/password auth)`);
  }

  const config = parseConfig(raw, dirname(fullPath));
  if (!config.masterKey) config.masterKey = localMasterKey(config.databasePath);
  return config;
}

/** Dev convenience: keep a generated key next to the database when none is configured. */
function localMasterKey(databasePath: string): string {
  if (process.env.NODE_ENV === "production") {
    throw new Error("server.master_key must be set in production (e.g. master_key = \"${SECENV_MASTER_KEY}\")");
  }
  const keyPath = resolve(databasePath === ":memory:" ? "./data" : dirname(databasePath), "master.key");
  if (!existsSync(keyPath)) {
    mkdirSync(dirname(keyPath), { recursive: true });
    writeFileSync(keyPath, randomBytes(32).toString("base64"), { mode: 0o600 });
    console.warn(`[secenv] generated a development master key at ${keyPath}. Back it up: values cannot be decrypted without it.`);
  }
  return readFileSync(keyPath, "utf8").trim();
}

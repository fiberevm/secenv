import type { OidcConfig } from "./config";
import { pkceChallenge, randomToken } from "./crypto";
import { AppError } from "./errors";

type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
};

export type OidcIdentity = {
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
};

type Pending = { nonce: string; verifier: string; expiresAt: number };

/**
 * Authorization-code flow with PKCE. The ID token comes straight from the token
 * endpoint over TLS, so per OIDC Core §3.1.3.7 we validate its claims (iss, aud,
 * exp, nonce) and rely on the TLS channel instead of fetching JWKS.
 */
export class OidcClient {
  private discovery: Promise<Discovery> | null = null;
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly config: OidcConfig,
    private readonly redirectUri: string,
  ) {}

  private discover(): Promise<Discovery> {
    this.discovery ??= fetch(`${this.config.issuer}/.well-known/openid-configuration`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`OIDC discovery failed: HTTP ${res.status}`);
        return (await res.json()) as Discovery;
      })
      .catch((error) => {
        this.discovery = null; // retry on the next login attempt
        throw error;
      });
    return this.discovery;
  }

  async start(): Promise<{ url: string; state: string }> {
    const discovery = await this.discover();
    const state = randomToken(24);
    const nonce = randomToken(24);
    const verifier = randomToken(48);
    const now = Date.now();
    for (const [key, value] of this.pending) if (value.expiresAt < now) this.pending.delete(key);
    this.pending.set(state, { nonce, verifier, expiresAt: now + 10 * 60_000 });

    const url = new URL(discovery.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: this.config.clientId,
      redirect_uri: this.redirectUri,
      scope: this.config.scopes.join(" "),
      state,
      nonce,
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: "S256",
    }).toString();
    return { url: url.toString(), state };
  }

  async finish(state: string, code: string): Promise<OidcIdentity> {
    const pending = this.pending.get(state);
    this.pending.delete(state);
    if (!pending || pending.expiresAt < Date.now()) throw new AppError(400, "Sign-in expired. Please try again.");

    const discovery = await this.discover();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUri,
      code_verifier: pending.verifier,
    });
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    };
    if (this.config.tokenAuthMethod === "client_secret_basic") {
      const encode = (s: string) => encodeURIComponent(s);
      headers.Authorization = `Basic ${btoa(`${encode(this.config.clientId)}:${encode(this.config.clientSecret)}`)}`;
    } else {
      body.set("client_id", this.config.clientId);
      body.set("client_secret", this.config.clientSecret);
    }

    const res = await fetch(discovery.token_endpoint, { method: "POST", headers, body });
    const tokens = (await res.json().catch(() => ({}))) as { id_token?: string; access_token?: string; error?: string };
    if (!res.ok || !tokens.id_token) {
      throw new AppError(502, `Identity provider rejected the sign-in (${tokens.error ?? `HTTP ${res.status}`})`);
    }

    const claims = decodeJwtPayload(tokens.id_token);
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== discovery.issuer) throw new AppError(401, "ID token issuer mismatch");
    if (!audience.includes(this.config.clientId)) throw new AppError(401, "ID token audience mismatch");
    if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now() - 60_000) throw new AppError(401, "ID token expired");
    if (claims.nonce !== pending.nonce) throw new AppError(401, "ID token nonce mismatch");

    let profile: Record<string, unknown> = claims;
    if (!claims.email && discovery.userinfo_endpoint && tokens.access_token) {
      const info = await fetch(discovery.userinfo_endpoint, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      if (info.ok) profile = { ...claims, ...((await info.json()) as Record<string, unknown>) };
    }
    if (typeof profile.email !== "string" || !profile.email) {
      throw new AppError(401, "The identity provider did not share an email address. Add the `email` scope.");
    }
    return {
      subject: `${discovery.issuer}|${String(claims.sub)}`,
      email: profile.email.toLowerCase(),
      // Providers that omit the claim are treated as verified; explicit false is not.
      emailVerified: profile.email_verified !== false && profile.email_verified !== "false",
      name: typeof profile.name === "string" ? profile.name : "",
    };
  }
}

function decodeJwtPayload(jwt: string): Record<string, any> {
  const part = jwt.split(".")[1];
  if (!part) throw new AppError(401, "Malformed ID token");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

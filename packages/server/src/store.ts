import type { Database } from "bun:sqlite";
import { randomToken, sha256Hex, type Vault } from "./crypto";
import { badRequest, conflict, notFound } from "./errors";

export type ActorKind = "user" | "token" | "mcp";
export type Actor = { id: string | null; label: string; kind: ActorKind; ip?: string | null; userAgent?: string | null };

/** Where a secret value was shown. Recorded on var.view / env.read events. */
export type ViewSource = "reveal" | "copy" | "edit" | "export" | "history" | "mcp" | "sdk";

export type User = {
  id: string;
  email: string;
  name: string;
  createdAt: number;
  lastLoginAt: number | null;
};

export type Group = {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  variableCount: number;
};

/** Variable metadata without its value. Values are only returned through audited reveals. */
export type VariableMeta = {
  id: string;
  key: string;
  valueLength: number;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
};

export type Variable = {
  id: string;
  key: string;
  value: string;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
};

export type TokenAccess = "read" | "write";

export type ApiToken = {
  id: string;
  name: string;
  prefix: string;
  access: TokenAccess;
  /** null means every group. */
  groupIds: string[] | null;
  createdBy: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
};

export type AuditAction =
  | "group.create"
  | "group.update"
  | "group.delete"
  | "var.create"
  | "var.update"
  | "var.delete"
  | "token.create"
  | "token.revoke"
  | "var.view"
  | "env.read";

/** Actions that read values rather than change anything. */
export const VIEW_ACTIONS = ["var.view", "env.read"] as const;
const CHANGE_FILTER = "action NOT IN ('var.view', 'env.read')";

export type AuditEvent = {
  id: number;
  at: number;
  actorLabel: string;
  actorKind: ActorKind;
  action: AuditAction;
  groupId: string | null;
  groupName: string | null;
  key: string | null;
  hasOldValue: boolean;
  hasNewValue: boolean;
  meta: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
};

export const GROUP_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const VAR_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,255}$/;
const MAX_VALUE_BYTES = 64 * 1024;

function checkGroupName(name: string): string {
  const trimmed = name.trim();
  if (!GROUP_NAME_PATTERN.test(trimmed)) {
    throw badRequest("Group names use letters, numbers, dots, dashes and underscores (max 64), e.g. backend-production");
  }
  return trimmed;
}

function checkKey(key: string): string {
  const trimmed = key.trim();
  if (!VAR_KEY_PATTERN.test(trimmed)) {
    throw badRequest(`"${trimmed}" is not a valid key. Use letters, numbers and underscores, starting with a letter or underscore.`);
  }
  return trimmed;
}

function checkValue(value: string): string {
  if (typeof value !== "string") throw badRequest("Value must be a string");
  if (Buffer.byteLength(value) > MAX_VALUE_BYTES) throw badRequest("Values are limited to 64 KB");
  return value;
}

type Row = Record<string, any>;

const toUser = (r: Row): User => ({
  id: r.id,
  email: r.email,
  name: r.name,
  createdAt: r.created_at,
  lastLoginAt: r.last_login_at,
});

const toGroup = (r: Row): Group => ({
  id: r.id,
  name: r.name,
  description: r.description,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  variableCount: r.variable_count ?? 0,
});

const toToken = (r: Row): ApiToken => ({
  id: r.id,
  name: r.name,
  prefix: r.prefix,
  access: r.access,
  groupIds: r.group_ids ? JSON.parse(r.group_ids) : null,
  createdBy: r.created_by,
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
  revokedAt: r.revoked_at,
});

const toEvent = (r: Row): AuditEvent => ({
  id: r.id,
  at: r.at,
  actorLabel: r.actor_label,
  actorKind: r.actor_kind,
  action: r.action,
  groupId: r.group_id,
  groupName: r.group_name,
  key: r.var_key,
  hasOldValue: r.old_value_enc !== null,
  hasNewValue: r.new_value_enc !== null,
  meta: r.meta ? JSON.parse(r.meta) : null,
  ip: r.ip ?? null,
  userAgent: r.user_agent ?? null,
});

export class Store {
  constructor(
    readonly db: Database,
    private readonly vault: Vault,
  ) {}

  // ── Users & sessions ────────────────────────────────────────────────

  countUsers(): number {
    return (this.db.query("SELECT COUNT(*) AS n FROM users").get() as Row).n;
  }

  listUsers(): User[] {
    return this.db.query("SELECT * FROM users ORDER BY created_at").all().map((r) => toUser(r as Row));
  }

  findUserByEmail(email: string): (User & { passwordHash: string | null; oidcSubject: string | null }) | null {
    const row = this.db.query("SELECT * FROM users WHERE email = ?").get(email.trim()) as Row | null;
    return row ? { ...toUser(row), passwordHash: row.password_hash, oidcSubject: row.oidc_subject } : null;
  }

  findUserByOidcSubject(subject: string): User | null {
    const row = this.db.query("SELECT * FROM users WHERE oidc_subject = ?").get(subject) as Row | null;
    return row ? toUser(row) : null;
  }

  createUser(input: { email: string; name?: string; passwordHash?: string; oidcSubject?: string }): User {
    const id = Bun.randomUUIDv7();
    try {
      this.db
        .query(
          "INSERT INTO users (id, email, name, password_hash, oidc_subject, created_at) VALUES ($id, $email, $name, $passwordHash, $oidcSubject, $now)",
        )
        .run({
          id,
          email: input.email.trim().toLowerCase(),
          name: input.name?.trim() ?? "",
          passwordHash: input.passwordHash ?? null,
          oidcSubject: input.oidcSubject ?? null,
          now: Date.now(),
        });
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw conflict("An account with that email already exists");
      throw error;
    }
    return toUser(this.db.query("SELECT * FROM users WHERE id = ?").get(id) as Row);
  }

  linkOidcSubject(userId: string, subject: string, name: string): void {
    this.db.query("UPDATE users SET oidc_subject = ?, name = CASE WHEN name = '' THEN ? ELSE name END WHERE id = ?").run(subject, name, userId);
  }

  createSession(userId: string, ttlMs: number): string {
    const token = randomToken();
    const now = Date.now();
    this.db.query("DELETE FROM sessions WHERE expires_at < ?").run(now);
    this.db
      .query("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(sha256Hex(token), userId, now, now + ttlMs);
    this.db.query("UPDATE users SET last_login_at = ? WHERE id = ?").run(now, userId);
    return token;
  }

  getSessionUser(token: string): User | null {
    const row = this.db
      .query("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?")
      .get(sha256Hex(token), Date.now()) as Row | null;
    return row ? toUser(row) : null;
  }

  deleteSession(token: string): void {
    this.db.query("DELETE FROM sessions WHERE token_hash = ?").run(sha256Hex(token));
  }

  // ── Groups ──────────────────────────────────────────────────────────

  listGroups(): Group[] {
    return this.db
      .query(
        `SELECT g.*, (SELECT COUNT(*) FROM env_vars v WHERE v.group_id = g.id) AS variable_count
         FROM env_groups g ORDER BY g.name COLLATE NOCASE`,
      )
      .all()
      .map((r) => toGroup(r as Row));
  }

  getGroup(id: string): Group {
    const row = this.db
      .query(
        `SELECT g.*, (SELECT COUNT(*) FROM env_vars v WHERE v.group_id = g.id) AS variable_count
         FROM env_groups g WHERE g.id = ?1 OR g.name = ?1`,
      )
      .get(id) as Row | null;
    if (!row) throw notFound(`Env group "${id}" not found`);
    return toGroup(row);
  }

  createGroup(input: { name: string; description?: string }, actor: Actor): Group {
    const name = checkGroupName(input.name);
    const description = (input.description ?? "").trim().slice(0, 500);
    const id = Bun.randomUUIDv7();
    const now = Date.now();
    this.db.transaction(() => {
      if (this.db.query("SELECT 1 FROM env_groups WHERE name = ?").get(name)) {
        throw conflict(`An env group named "${name}" already exists`);
      }
      this.db
        .query("INSERT INTO env_groups (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run(id, name, description, now, now);
      this.record(actor, "group.create", { groupId: id, groupName: name });
    })();
    return this.getGroup(id);
  }

  updateGroup(id: string, input: { name?: string; description?: string }, actor: Actor): Group {
    const group = this.getGroup(id);
    const name = input.name === undefined ? group.name : checkGroupName(input.name);
    const description = input.description === undefined ? group.description : input.description.trim().slice(0, 500);
    if (name === group.name && description === group.description) return group;

    this.db.transaction(() => {
      if (name !== group.name && this.db.query("SELECT 1 FROM env_groups WHERE name = ? AND id != ?").get(name, group.id)) {
        throw conflict(`An env group named "${name}" already exists`);
      }
      this.db
        .query("UPDATE env_groups SET name = ?, description = ?, updated_at = ? WHERE id = ?")
        .run(name, description, Date.now(), group.id);
      const meta: Record<string, unknown> = {};
      if (name !== group.name) meta.renamedFrom = group.name;
      if (description !== group.description) meta.description = { from: group.description, to: description };
      this.record(actor, "group.update", { groupId: group.id, groupName: name, meta });
    })();
    return this.getGroup(group.id);
  }

  deleteGroup(id: string, actor: Actor): void {
    const group = this.getGroup(id);
    this.db.transaction(() => {
      const keys = this.db.query("SELECT key FROM env_vars WHERE group_id = ? ORDER BY key").all(group.id).map((r) => (r as Row).key);
      this.db.query("DELETE FROM env_groups WHERE id = ?").run(group.id);
      this.record(actor, "group.delete", { groupId: group.id, groupName: group.name, meta: { keys } });
    })();
  }

  // ── Variables ───────────────────────────────────────────────────────

  listVariables(groupId: string): Variable[] {
    const group = this.getGroup(groupId);
    return this.db
      .query("SELECT * FROM env_vars WHERE group_id = ? ORDER BY key")
      .all(group.id)
      .map((row) => {
        const r = row as Row;
        return {
          id: r.id,
          key: r.key,
          value: this.vault.decrypt(r.value_enc),
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          updatedBy: r.updated_by,
        };
      });
  }

  listVariableMeta(groupId: string): VariableMeta[] {
    const group = this.getGroup(groupId);
    return this.listVariables(group.id).map(({ value, ...rest }) => ({ ...rest, valueLength: value.length }));
  }

  /**
   * Return decrypted values and record one var.view event per key.
   * `ids` null means every variable in the group.
   */
  revealVariables(groupId: string, ids: string[] | null, actor: Actor, source: ViewSource): Record<string, string> {
    const group = this.getGroup(groupId);
    const wanted = ids ? new Set(ids) : null;
    const variables = this.listVariables(group.id).filter((v) => !wanted || wanted.has(v.id) || wanted.has(v.key));
    if (wanted && variables.length === 0) throw notFound("Variable not found");
    this.db.transaction(() => {
      for (const v of variables) {
        this.record(actor, "var.view", { groupId: group.id, groupName: group.name, key: v.key, meta: { source } });
      }
    })();
    return Object.fromEntries(variables.map((v) => [v.id, v.value]));
  }

  /** Record that a token loaded whole groups (SDK, CLI, HTTP). One event per group, listing its keys. */
  recordEnvRead(groups: Group[], actor: Actor, source: ViewSource) {
    this.db.transaction(() => {
      for (const group of groups) {
        const keys = this.db.query("SELECT key FROM env_vars WHERE group_id = ? ORDER BY key").all(group.id).map((r) => (r as Row).key);
        this.record(actor, "env.read", { groupId: group.id, groupName: group.name, meta: { source, keys } });
      }
    })();
  }

  /** Merge several groups in order; later groups win, like linked env groups on Render. */
  resolveEnv(groupIds: string[]): Record<string, string> {
    const env: Record<string, string> = {};
    for (const id of groupIds) {
      for (const variable of this.listVariables(id)) env[variable.key] = variable.value;
    }
    return env;
  }

  createVariable(groupId: string, input: { key: string; value: string }, actor: Actor): Variable {
    const group = this.getGroup(groupId);
    const key = checkKey(input.key);
    const value = checkValue(input.value);
    this.db.transaction(() => {
      if (this.db.query("SELECT 1 FROM env_vars WHERE group_id = ? AND key = ?").get(group.id, key)) {
        throw conflict(`${key} already exists in ${group.name}`);
      }
      this.insertVariable(group, key, value, actor);
    })();
    return this.getVariableByKey(group.id, key);
  }

  updateVariable(groupId: string, variableId: string, input: { key?: string; value?: string }, actor: Actor): Variable {
    const group = this.getGroup(groupId);
    const row = this.db.query("SELECT * FROM env_vars WHERE id = ? AND group_id = ?").get(variableId, group.id) as Row | null;
    if (!row) throw notFound("Variable not found");
    const oldValue = this.vault.decrypt(row.value_enc);
    const key = input.key === undefined ? row.key : checkKey(input.key);
    const value = input.value === undefined ? oldValue : checkValue(input.value);
    if (key === row.key && value === oldValue) return this.getVariableByKey(group.id, key);

    this.db.transaction(() => {
      if (key !== row.key && this.db.query("SELECT 1 FROM env_vars WHERE group_id = ? AND key = ?").get(group.id, key)) {
        throw conflict(`${key} already exists in ${group.name}`);
      }
      this.writeUpdate(group, row, key, oldValue, value, actor);
    })();
    return this.getVariableByKey(group.id, key);
  }

  /** Create or update by key. Used by MCP and .env imports. Returns what happened. */
  upsertVariable(groupId: string, input: { key: string; value: string }, actor: Actor): "created" | "updated" | "unchanged" {
    const group = this.getGroup(groupId);
    const key = checkKey(input.key);
    const value = checkValue(input.value);
    let outcome: "created" | "updated" | "unchanged" = "unchanged";
    this.db.transaction(() => {
      const row = this.db.query("SELECT * FROM env_vars WHERE group_id = ? AND key = ?").get(group.id, key) as Row | null;
      if (!row) {
        this.insertVariable(group, key, value, actor);
        outcome = "created";
        return;
      }
      const oldValue = this.vault.decrypt(row.value_enc);
      if (oldValue === value) return;
      this.writeUpdate(group, row, key, oldValue, value, actor);
      outcome = "updated";
    })();
    return outcome;
  }

  importVariables(groupId: string, entries: Array<{ key: string; value: string }>, overwrite: boolean, actor: Actor) {
    const group = this.getGroup(groupId);
    for (const entry of entries) checkKey(entry.key);
    const summary = { created: 0, updated: 0, unchanged: 0, skipped: 0 };
    this.db.transaction(() => {
      for (const entry of entries) {
        const exists = this.db.query("SELECT 1 FROM env_vars WHERE group_id = ? AND key = ?").get(group.id, entry.key);
        if (exists && !overwrite) {
          summary.skipped++;
          continue;
        }
        summary[this.upsertVariable(group.id, entry, actor)]++;
      }
    })();
    return summary;
  }

  deleteVariable(groupId: string, variableIdOrKey: string, actor: Actor): void {
    const group = this.getGroup(groupId);
    const row = this.db
      .query("SELECT * FROM env_vars WHERE group_id = ?1 AND (id = ?2 OR key = ?2)")
      .get(group.id, variableIdOrKey) as Row | null;
    if (!row) throw notFound("Variable not found");
    this.db.transaction(() => {
      this.db.query("DELETE FROM env_vars WHERE id = ?").run(row.id);
      this.touchGroup(group.id);
      this.record(actor, "var.delete", { groupId: group.id, groupName: group.name, key: row.key, oldValueEnc: row.value_enc });
    })();
  }

  private getVariableByKey(groupId: string, key: string): Variable {
    const found = this.listVariables(groupId).find((v) => v.key === key);
    if (!found) throw notFound("Variable not found");
    return found;
  }

  private insertVariable(group: Group, key: string, value: string, actor: Actor) {
    const now = Date.now();
    const valueEnc = this.vault.encrypt(value);
    this.db
      .query(
        "INSERT INTO env_vars (id, group_id, key, value_enc, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(Bun.randomUUIDv7(), group.id, key, valueEnc, now, now, actor.label);
    this.touchGroup(group.id);
    this.record(actor, "var.create", { groupId: group.id, groupName: group.name, key, newValueEnc: valueEnc });
  }

  private writeUpdate(group: Group, row: Row, key: string, oldValue: string, value: string, actor: Actor) {
    const valueEnc = value === oldValue ? row.value_enc : this.vault.encrypt(value);
    this.db
      .query("UPDATE env_vars SET key = ?, value_enc = ?, updated_at = ?, updated_by = ? WHERE id = ?")
      .run(key, valueEnc, Date.now(), actor.label, row.id);
    this.touchGroup(group.id);
    this.record(actor, "var.update", {
      groupId: group.id,
      groupName: group.name,
      key,
      oldValueEnc: row.value_enc,
      newValueEnc: valueEnc,
      meta: {
        ...(key !== row.key ? { renamedFrom: row.key } : {}),
        valueChanged: value !== oldValue,
      },
    });
  }

  private touchGroup(groupId: string) {
    this.db.query("UPDATE env_groups SET updated_at = ? WHERE id = ?").run(Date.now(), groupId);
  }

  // ── API tokens ──────────────────────────────────────────────────────

  listTokens(): ApiToken[] {
    return this.db
      .query("SELECT * FROM api_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC")
      .all()
      .map((r) => toToken(r as Row));
  }

  createToken(input: { name: string; access: TokenAccess; groupIds: string[] | null }, actor: Actor) {
    const name = input.name.trim();
    if (!name || name.length > 80) throw badRequest("Token name is required (max 80 characters)");
    if (input.access !== "read" && input.access !== "write") throw badRequest('access must be "read" or "write"');
    const groupIds = input.groupIds?.map((id) => this.getGroup(id).id) ?? null;
    if (groupIds && groupIds.length === 0) throw badRequest("Pick at least one group, or allow all groups");

    const secret = `se_${randomToken(24)}`;
    const id = Bun.randomUUIDv7();
    this.db.transaction(() => {
      this.db
        .query(
          "INSERT INTO api_tokens (id, name, token_hash, prefix, access, group_ids, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(id, name, sha256Hex(secret), secret.slice(0, 10), input.access, groupIds ? JSON.stringify(groupIds) : null, actor.label, Date.now());
      this.record(actor, "token.create", { meta: { tokenId: id, name, access: input.access } });
    })();
    const token = toToken(this.db.query("SELECT * FROM api_tokens WHERE id = ?").get(id) as Row);
    return { token, secret };
  }

  revokeToken(id: string, actor: Actor): void {
    const row = this.db.query("SELECT * FROM api_tokens WHERE id = ? AND revoked_at IS NULL").get(id) as Row | null;
    if (!row) throw notFound("Token not found");
    this.db.transaction(() => {
      this.db.query("UPDATE api_tokens SET revoked_at = ? WHERE id = ?").run(Date.now(), id);
      this.record(actor, "token.revoke", { meta: { tokenId: id, name: row.name } });
    })();
  }

  authenticateToken(secret: string): ApiToken | null {
    const row = this.db
      .query("SELECT * FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL")
      .get(sha256Hex(secret)) as Row | null;
    if (!row) return null;
    // Only write last_used_at once a minute so busy deploys do not hammer the database.
    const now = Date.now();
    if (!row.last_used_at || now - row.last_used_at > 60_000) {
      this.db.query("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(now, row.id);
    }
    return toToken(row);
  }

  // ── Audit log ───────────────────────────────────────────────────────

  private record(
    actor: Actor,
    action: AuditAction,
    fields: {
      groupId?: string;
      groupName?: string;
      key?: string;
      oldValueEnc?: string;
      newValueEnc?: string;
      meta?: Record<string, unknown>;
    },
  ) {
    this.db
      .query(
        `INSERT INTO audit_events (at, actor_id, actor_label, actor_kind, action, group_id, group_name, var_key, old_value_enc, new_value_enc, meta, ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        Date.now(),
        actor.id,
        actor.label,
        actor.kind,
        action,
        fields.groupId ?? null,
        fields.groupName ?? null,
        fields.key ?? null,
        fields.oldValueEnc ?? null,
        fields.newValueEnc ?? null,
        fields.meta && Object.keys(fields.meta).length ? JSON.stringify(fields.meta) : null,
        actor.ip ?? null,
        actor.userAgent?.slice(0, 300) ?? null,
      );
  }

  listEvents(filter: { groupId?: string; action?: string; actor?: string; ip?: string; before?: number; limit?: number }) {
    const where: string[] = [];
    const params: Record<string, string | number> = {};
    if (filter.groupId) {
      where.push("group_id = $groupId");
      params.groupId = filter.groupId;
    }
    if (filter.action === "changes") {
      where.push(CHANGE_FILTER);
    } else if (filter.action === "views") {
      where.push("action IN ('var.view', 'env.read')");
    } else if (filter.action === "var") {
      where.push("action IN ('var.create', 'var.update', 'var.delete')");
    } else if (filter.action) {
      // "group" matches every group.* action; "var.update" matches exactly.
      where.push(filter.action.includes(".") ? "action = $action" : "action LIKE $action || '.%'");
      params.action = filter.action;
    }
    if (filter.ip) {
      where.push("ip = $ip");
      params.ip = filter.ip;
    }
    if (filter.actor) {
      where.push("actor_label = $actor");
      params.actor = filter.actor;
    }
    if (filter.before) {
      where.push("id < $before");
      params.before = filter.before;
    }
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const rows = this.db
      .query(
        `SELECT * FROM audit_events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ${limit + 1}`,
      )
      .all(params) as Row[];
    const events = rows.slice(0, limit).map(toEvent);
    return { events, nextCursor: rows.length > limit ? events[events.length - 1]!.id : null };
  }

  /** Decrypt the before/after values of a past change. Viewing history is itself recorded. */
  getEventValues(id: number, actor: Actor): { oldValue: string | null; newValue: string | null } {
    const row = this.db.query("SELECT * FROM audit_events WHERE id = ?").get(id) as Row | null;
    if (!row) throw notFound("Event not found");
    if (row.old_value_enc !== null || row.new_value_enc !== null) {
      this.record(actor, "var.view", {
        groupId: row.group_id,
        groupName: row.group_name,
        key: row.var_key,
        meta: { source: "history", eventId: id },
      });
    }
    return {
      oldValue: row.old_value_enc ? this.vault.decrypt(row.old_value_enc) : null,
      newValue: row.new_value_enc ? this.vault.decrypt(row.new_value_enc) : null,
    };
  }

  listActors(): string[] {
    return this.db.query("SELECT DISTINCT actor_label FROM audit_events ORDER BY actor_label").all().map((r) => (r as Row).actor_label);
  }

  /** Counts for the overview dashboard. `tzOffsetMinutes` is the browser's getTimezoneOffset(). */
  stats(tzOffsetMinutes: number, days = 30) {
    const since = Date.now() - days * 86_400_000;
    const count = (sql: string, ...args: number[]) => (this.db.query(sql).get(...args) as Row).n as number;
    const daily = this.db
      .query(
        `SELECT date(at / 1000 - ?1 * 60, 'unixepoch') AS day, action, COUNT(*) AS n
         FROM audit_events WHERE at >= ?2 AND action IN ('var.create', 'var.update', 'var.delete') GROUP BY day, action ORDER BY day`,
      )
      .all(tzOffsetMinutes, since) as Array<{ day: string; action: string; n: number }>;
    const topGroups = this.db
      .query(
        `SELECT group_id AS id, group_name AS name, COUNT(*) AS changes FROM audit_events
         WHERE at >= ? AND action IN ('var.create', 'var.update', 'var.delete') AND group_id IN (SELECT id FROM env_groups)
         GROUP BY group_id ORDER BY changes DESC LIMIT 5`,
      )
      .all(since) as Array<{ id: string; name: string; changes: number }>;
    const topActors = this.db
      .query(
        `SELECT actor_label AS label, actor_kind AS kind, COUNT(*) AS changes FROM audit_events
         WHERE at >= ? AND ${CHANGE_FILTER} GROUP BY actor_label ORDER BY changes DESC LIMIT 5`,
      )
      .all(since) as Array<{ label: string; kind: ActorKind; changes: number }>;

    return {
      groups: count("SELECT COUNT(*) AS n FROM env_groups"),
      variables: count("SELECT COUNT(*) AS n FROM env_vars"),
      tokens: count("SELECT COUNT(*) AS n FROM api_tokens WHERE revoked_at IS NULL"),
      users: count("SELECT COUNT(*) AS n FROM users"),
      changes7d: count(`SELECT COUNT(*) AS n FROM audit_events WHERE at >= ? AND ${CHANGE_FILTER}`, Date.now() - 7 * 86_400_000),
      views7d: count("SELECT COUNT(*) AS n FROM audit_events WHERE at >= ? AND action = 'var.view'", Date.now() - 7 * 86_400_000),
      reads7d: count("SELECT COUNT(*) AS n FROM audit_events WHERE at >= ? AND action = 'env.read'", Date.now() - 7 * 86_400_000),
      changesPrev7d: count(
        `SELECT COUNT(*) AS n FROM audit_events WHERE at >= ? AND at < ? AND ${CHANGE_FILTER}`,
        Date.now() - 14 * 86_400_000,
        Date.now() - 7 * 86_400_000,
      ),
      daily,
      topGroups,
      topActors,
    };
  }
}

#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createClient, SecenvError } from "./index.js";

const HELP = `secenv: load env groups from a secenv server

Usage
  secenv run -g <groups> [--override] -- <command> [args...]
  secenv export -g <groups> [--format dotenv|json|shell]
  secenv mcp                 stdio MCP bridge to <url>/mcp

Options
  -g, --groups <a,b>   Env groups, merged in order (default: $SECENV_GROUPS)
  --url <url>          Server URL (default: $SECENV_URL)
  --token <token>      API token (default: $SECENV_TOKEN)
  --override           Let secenv values replace variables already set (run)
  -h, --help           Show this help
`;

type Flags = { groups?: string; url?: string; token?: string; format?: string; override?: boolean; rest: string[] };

function parseArgs(argv: string[]): { command: string | undefined; flags: Flags } {
  const flags: Flags = { rest: [] };
  let command: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = () => {
      const value = argv[++i];
      if (value === undefined) fail(`${arg} needs a value`);
      return value;
    };
    if (arg === "--") {
      flags.rest = argv.slice(i + 1);
      break;
    } else if (arg === "-g" || arg === "--groups") flags.groups = next();
    else if (arg === "--url") flags.url = next();
    else if (arg === "--token") flags.token = next();
    else if (arg === "--format") flags.format = next();
    else if (arg === "--override") flags.override = true;
    else if (arg === "-h" || arg === "--help") command = "help";
    else if (!command) command = arg;
    else flags.rest.push(arg);
  }
  return { command, flags };
}

function fail(message: string): never {
  process.stderr.write(`secenv: ${message}\n`);
  process.exit(1);
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (!command || command === "help") {
    process.stdout.write(HELP);
    return;
  }

  const client = createClient({ url: flags.url, token: flags.token });

  if (command === "run") {
    if (flags.rest.length === 0) fail("nothing to run. Usage: secenv run -g <groups> -- <command>");
    const { variables } = await client.getEnv(flags.groups);
    const childEnv = flags.override ? { ...process.env, ...variables } : { ...variables, ...process.env };
    const child = spawn(flags.rest[0]!, flags.rest.slice(1), { stdio: "inherit", env: childEnv, shell: process.platform === "win32" });
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => child.kill(signal));
    child.on("error", (error) => fail(error.message));
    child.on("exit", (code, signal) => (signal ? process.kill(process.pid, signal) : process.exit(code ?? 0)));
    return;
  }

  if (command === "export") {
    const { variables } = await client.getEnv(flags.groups);
    const entries = Object.entries(variables);
    const format = flags.format ?? "dotenv";
    if (format === "json") process.stdout.write(JSON.stringify(variables, null, 2) + "\n");
    else if (format === "shell") process.stdout.write(entries.map(([k, v]) => `export ${k}=${shellQuote(v)}`).join("\n") + "\n");
    else if (format === "dotenv") process.stdout.write(entries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("\n") + "\n");
    else fail(`unknown format "${format}" (use dotenv, json or shell)`);
    return;
  }

  if (command === "mcp") {
    // Newline-delimited JSON-RPC on stdio <-> Streamable HTTP on the server.
    const lines = createInterface({ input: process.stdin });
    for await (const line of lines) {
      if (!line.trim()) continue;
      let id: unknown = null;
      try {
        id = (JSON.parse(line) as { id?: unknown }).id ?? null;
      } catch {
        // Let the server produce the parse error.
      }
      try {
        const res = await client.request("/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
          body: line,
        });
        if (res.status === 202) continue;
        const text = await res.text();
        if (text.trim()) process.stdout.write(text.trim() + "\n");
      } catch (error) {
        if (id !== null) {
          const message = error instanceof Error ? error.message : String(error);
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32603, message } }) + "\n");
        }
      }
    }
    return;
  }

  fail(`unknown command "${command}". Run secenv --help.`);
}

main().catch((error) => fail(error instanceof SecenvError ? error.message : String(error?.stack ?? error)));

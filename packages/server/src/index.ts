import ui from "../web/index.html";
import { createServer } from "./app";
import { loadConfig } from "./config";

const config = loadConfig();
const { server } = createServer(config, {
  ui,
  development: process.env.NODE_ENV !== "production" ? { hmr: true, console: true } : false,
});

const methods = [config.auth.password.enabled && "email/password", config.auth.oidc && `OIDC (${config.auth.oidc.displayName})`]
  .filter(Boolean)
  .join(" + ");
console.log(`[secenv] running at ${server.url} (auth: ${methods})`);
console.log(`[secenv] MCP endpoint: ${config.publicUrl}/mcp`);

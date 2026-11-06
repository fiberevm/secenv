import { AppError, badRequest } from "./errors";

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof AppError) return json({ error: error.message }, error.status);
  console.error("[secenv] unhandled error", error);
  return json({ error: "Something went wrong" }, 500);
}

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  if (!req.headers.get("content-type")?.includes("application/json")) {
    throw new AppError(415, "Send a JSON body with Content-Type: application/json");
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw badRequest("Body must be a JSON object");
  return body as Record<string, unknown>;
}

export function field(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string") throw badRequest(`"${key}" is required`);
  return value;
}

export function optionalField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw badRequest(`"${key}" must be a string`);
  return value;
}

export function getCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function cookie(name: string, value: string, options: { maxAgeSeconds: number; secure: boolean; path?: string }): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path ?? "/"}`,
    `Max-Age=${options.maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Lax",
    options.secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  const match = header ? /^Bearer\s+(.+)$/i.exec(header) : null;
  return match ? match[1]!.trim() : null;
}

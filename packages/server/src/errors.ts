/** An error with a user-facing message and HTTP status, shared by the REST API and MCP. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new AppError(400, message);
export const notFound = (message: string) => new AppError(404, message);
export const forbidden = (message: string) => new AppError(403, message);
export const conflict = (message: string) => new AppError(409, message);

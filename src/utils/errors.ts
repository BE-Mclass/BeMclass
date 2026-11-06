export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;
  public readonly errors?: Record<string, string>;

  constructor(
    message: string,
    statusCode = 400,
    options?: { code?: string; errors?: Record<string, string> }
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = options?.code;
    this.errors = options?.errors;
  }
}

export const ExitCode = {
  Success: 0,
  Failure: 1,
  Usage: 2,
  Auth: 3,
  RateLimited: 4,
  WaitTimeout: 5,
  Partial: 6,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export type ErrorEnvelope = {
  error: {
    code: string;
    message: string;
    hint?: string;
    status?: number;
    valid_values?: string[];
    usage?: string;
    details?: unknown;
    request_id?: string;
    rate_limit?: Record<string, string | number>;
  };
};

export class CLIError extends Error {
  readonly code: string;
  readonly exitCode: ExitCodeValue;
  readonly hint: string | undefined;
  readonly status: number | undefined;
  readonly validValues: string[] | undefined;
  readonly usage: string | undefined;
  readonly details: unknown;
  readonly requestId: string | undefined;
  readonly rateLimit: Record<string, string | number> | undefined;

  constructor(input: {
    code: string;
    message: string;
    exitCode?: ExitCodeValue;
    hint?: string;
    status?: number;
    validValues?: string[];
    usage?: string;
    details?: unknown;
    requestId?: string;
    rateLimit?: Record<string, string | number>;
  }) {
    super(input.message);
    this.name = "CLIError";
    this.code = input.code;
    this.exitCode = input.exitCode ?? ExitCode.Failure;
    this.hint = input.hint;
    this.status = input.status;
    this.validValues = input.validValues;
    this.usage = input.usage;
    this.details = input.details;
    this.requestId = input.requestId;
    this.rateLimit = input.rateLimit;
  }

  envelope(): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.hint ? { hint: this.hint } : {}),
        ...(this.status ? { status: this.status } : {}),
        ...(this.validValues ? { valid_values: this.validValues } : {}),
        ...(this.usage ? { usage: this.usage } : {}),
        ...(this.requestId ? { request_id: this.requestId } : {}),
        ...(this.rateLimit ? { rate_limit: this.rateLimit } : {}),
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (/token|secret|password|authorization|client_secret/i.test(key))
        out[key] = "[redacted]";
      else out[key] = redact(val);
    }
    return out;
  }
  return value;
}

export function toCLIError(error: unknown): CLIError {
  if (error instanceof CLIError) return error;
  if (error instanceof Error) {
    return new CLIError({
      code: "unexpected_error",
      message: error.message,
      details: redact(error),
    });
  }
  return new CLIError({ code: "unexpected_error", message: String(error) });
}

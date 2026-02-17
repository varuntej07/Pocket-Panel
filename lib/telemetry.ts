type LogLevel = "debug" | "info" | "warn" | "error";

type ErrorWithMetadata = Error & {
  code?: unknown;
  statusCode?: unknown;
  $metadata?: {
    requestId?: string;
    httpStatusCode?: number;
    attempts?: number;
    totalRetryDelay?: number;
  };
  cause?: unknown;
};

const levelPriority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const SENSITIVE_KEY_PATTERN = /(secret|token|password|authorization|access[_-]?key|api[_-]?key)/i;

const nowIso = (): string => new Date().toISOString();

const parseLogLevel = (value: string | undefined): LogLevel => {
  if (!value) {
    return "info";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "debug" || normalized === "info" || normalized === "warn" || normalized === "error") {
    return normalized;
  }
  return "info";
};

const configuredLogLevel = parseLogLevel(process.env.LOG_LEVEL);

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toDefinedEntries = (record: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));

export const toErrorMetadata = (error: unknown): Record<string, unknown> => {
  if (error instanceof Error) {
    const typedError = error as ErrorWithMetadata;
    const causeError = typedError.cause instanceof Error ? (typedError.cause as ErrorWithMetadata) : null;
    const causeMetadata =
      causeError
        ? {
            causeName: causeError.name,
            causeMessage: causeError.message,
            causeCode: typeof causeError.code === "string" ? causeError.code : undefined,
            causeHttpStatusCode:
              typeof causeError.statusCode === "number"
                ? causeError.statusCode
                : causeError.$metadata?.httpStatusCode,
            causeRequestId: causeError.$metadata?.requestId,
            causeSdkAttempts: causeError.$metadata?.attempts,
            causeSdkTotalRetryDelayMs: causeError.$metadata?.totalRetryDelay
          }
        : typedError.cause
          ? {
              cause: String(typedError.cause)
            }
          : {};

    return toDefinedEntries({
      errorName: typedError.name,
      errorMessage: typedError.message,
      errorCode: typeof typedError.code === "string" ? typedError.code : undefined,
      httpStatusCode:
        typeof typedError.statusCode === "number"
          ? typedError.statusCode
          : typedError.$metadata?.httpStatusCode,
      requestId: typedError.$metadata?.requestId,
      sdkAttempts: typedError.$metadata?.attempts,
      sdkTotalRetryDelayMs: typedError.$metadata?.totalRetryDelay,
      ...causeMetadata
    });
  }
  return {
    errorMessage: String(error)
  };
};

const sanitizeValue = (key: string, value: unknown, depth: number): unknown => {
  if (depth > 4) {
    return "[Truncated]";
  }
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return "[REDACTED]";
  }
  if (value instanceof Error) {
    return toErrorMetadata(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(key, entry, depth + 1));
  }
  if (!isObjectRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([nestedKey, nestedValue]) => [nestedKey, sanitizeValue(nestedKey, nestedValue, depth + 1)])
  );
};

const sanitizeMetadata = (metadata?: Record<string, unknown>): Record<string, unknown> | undefined => {
  if (!metadata) {
    return undefined;
  }
  const sanitized = Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [key, sanitizeValue(key, value, 0)])
  );
  return toDefinedEntries(sanitized);
};

const emitLog = (level: LogLevel, scope: string, message: string, metadata?: Record<string, unknown>): void => {
  if (levelPriority[level] < levelPriority[configuredLogLevel]) {
    return;
  }

  const sanitizedMetadata = sanitizeMetadata(metadata);
  const suffix =
    sanitizedMetadata && Object.keys(sanitizedMetadata).length > 0 ? ` ${JSON.stringify(sanitizedMetadata)}` : "";
  const line = `[${nowIso()}] [${level}] [${scope}] ${message}${suffix}`;

  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
};

export const logDebug = (scope: string, message: string, metadata?: Record<string, unknown>): void => {
  emitLog("debug", scope, message, metadata);
};

export const logInfo = (scope: string, message: string, metadata?: Record<string, unknown>): void => {
  emitLog("info", scope, message, metadata);
};

export const logWarn = (scope: string, message: string, metadata?: Record<string, unknown>): void => {
  emitLog("warn", scope, message, metadata);
};

export const logError = (scope: string, message: string, metadata?: Record<string, unknown>): void => {
  emitLog("error", scope, message, metadata);
};

import { logError, logWarn, toErrorMetadata } from "./telemetry";

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, context: string): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new TimeoutError(`${context} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

interface RetryContext {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  label: string;
  error: unknown;
}

interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  shouldRetry?: (error: unknown, attempt: number, maxAttempts: number) => boolean;
  onRetry?: (context: RetryContext) => void;
}

type ErrorWithMetadata = Error & {
  code?: unknown;
  $metadata?: {
    httpStatusCode?: number;
  };
  retryable?: boolean;
};

const RETRYABLE_ERROR_NAMES = new Set([
  "ThrottlingException",
  "TooManyRequestsException",
  "ServiceUnavailableException",
  "InternalFailure",
  "InternalServerException",
  "ModelTimeoutException",
  "ModelNotReadyException",
  "RequestTimeoutException",
  "TimeoutError",
  "NetworkingError"
]);

const NON_RETRYABLE_ERROR_NAMES = new Set(["AccessDeniedException", "ValidationException", "ResourceNotFoundException"]);

const extractStatusCode = (error: unknown): number | undefined => {
  if (!(error instanceof Error)) {
    return undefined;
  }
  const typedError = error as ErrorWithMetadata & { statusCode?: unknown };
  if (typeof typedError.statusCode === "number") {
    return typedError.statusCode;
  }
  return typedError.$metadata?.httpStatusCode;
};

export const isRetryableBedrockError = (error: unknown): boolean => {
  if (error instanceof TimeoutError) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const typedError = error as ErrorWithMetadata;
  if (typedError.retryable === true) {
    return true;
  }

  if (NON_RETRYABLE_ERROR_NAMES.has(error.name)) {
    return false;
  }
  if (RETRYABLE_ERROR_NAMES.has(error.name)) {
    return true;
  }

  const statusCode = extractStatusCode(error);
  if (statusCode === 429 || (typeof statusCode === "number" && statusCode >= 500)) {
    return true;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("throttl") ||
    message.includes("rate exceeded") ||
    message.includes("too many requests") ||
    message.includes("timed out") ||
    message.includes("temporarily unavailable")
  );
};

const getDelayMs = (attempt: number, baseDelayMs: number, maxDelayMs: number, jitterRatio: number): number => {
  const exponentialDelayMs = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, Math.max(0, attempt - 1)));
  const jitterDelta = exponentialDelayMs * jitterRatio;
  const minDelay = Math.max(0, exponentialDelayMs - jitterDelta);
  const maxDelay = exponentialDelayMs + jitterDelta;
  return Math.round(minDelay + Math.random() * (maxDelay - minDelay));
};

export const withRetry = async <T>(
  fn: () => Promise<T>,
  retriesOrOptions: number | RetryOptions,
  label: string
): Promise<T> => {
  const options: RetryOptions =
    typeof retriesOrOptions === "number" ? { maxAttempts: retriesOrOptions + 1 } : retriesOrOptions;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseDelayMs = Math.max(1, options.baseDelayMs ?? 300);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 6000);
  const jitterRatio = Math.min(1, Math.max(0, options.jitterRatio ?? 0.2));
  const shouldRetry = options.shouldRetry ?? isRetryableBedrockError;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const retryable = shouldRetry(error, attempt, maxAttempts);

      if (!retryable || attempt >= maxAttempts) {
        const reason = !retryable ? "non-retryable error" : "retry limit reached";
        const message = `${label} failed on attempt ${attempt}/${maxAttempts} (${reason})`;
        logError("retry", "Retry loop exiting with failure", {
          label,
          attempt,
          maxAttempts,
          retryable,
          reason,
          ...toErrorMetadata(error)
        });
        throw new Error(message, { cause: error instanceof Error ? error : undefined });
      }

      const delayMs = getDelayMs(attempt, baseDelayMs, maxDelayMs, jitterRatio);
      const retryContext: RetryContext = {
        attempt,
        maxAttempts,
        delayMs,
        label,
        error
      };

      options.onRetry?.(retryContext);
      logWarn("retry", "Retrying after transient failure", {
        label,
        attempt,
        maxAttempts,
        delayMs,
        ...toErrorMetadata(error)
      });
      await sleep(delayMs);
    }
  }

  throw new Error(`${label} failed after ${maxAttempts} attempts: ${String(lastError)}`);
};

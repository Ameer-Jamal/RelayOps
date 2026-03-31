export async function withRetry<T>(
  operation: () => Promise<T>,
  retries = 3,
  onRetry?: (attempt: number, error: unknown) => void
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        onRetry?.(attempt, error);
      }
    }
  }

  throw lastError;
}

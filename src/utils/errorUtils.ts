/**
 * Utility function to format error messages consistently
 */
export function formatErrorMessage(error: unknown, fallback = "Unknown error"): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * `notFound()` and `redirect()` signal by throwing. Those throws are control
 * flow, not failures, so a catch block that is there to report database
 * problems has to let them pass straight through.
 */
export function isFrameworkControlFlow(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof error.digest === "string" &&
    error.digest.startsWith("NEXT_")
  );
}

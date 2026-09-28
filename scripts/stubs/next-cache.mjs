/**
 * Stand-in for `next/cache` under `node --test`.
 *
 * Route handlers call `revalidatePath` after a write. Outside the framework
 * there is no cache and no request context, so these are no-ops -- which lets
 * the tests exercise the real exported handlers (auth, parsing, status codes)
 * rather than a copy of them with the framework bits cut out.
 */
export function revalidatePath() {}
export function revalidateTag() {}
export function updateTag() {}
export function unstable_cache(fn) {
  return fn;
}

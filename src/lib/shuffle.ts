/**
 * A shuffled copy of `items`, leaving the original alone.
 *
 * Fisher-Yates, so every ordering is equally likely -- the tempting
 * `sort(() => Math.random() - 0.5)` is not, and favours cards staying near
 * where they started. The random source is a parameter so tests can pin it.
 */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const result = [...items];
  for (let last = result.length - 1; last > 0; last--) {
    const pick = Math.floor(random() * (last + 1));
    [result[last], result[pick]] = [result[pick], result[last]];
  }
  return result;
}

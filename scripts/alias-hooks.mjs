import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

/**
 * Teaches `node --test` the "@/*" path alias from tsconfig.json.
 *
 * Next's bundler resolves it, but Node does not read tsconfig, so without this
 * hook any test that reaches app code fails on the first "@/lib/..." import.
 */
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(projectRoot, "src");

const CANDIDATE_SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

/** Framework modules with no meaning outside a Next server. */
const STUBS = new Map([
  ["next/cache", new URL("./stubs/next-cache.mjs", import.meta.url).href],
]);

export function resolve(specifier, context, nextResolve) {
  const stub = STUBS.get(specifier);
  if (stub) {
    return { url: stub, shortCircuit: true };
  }

  if (!specifier.startsWith("@/")) {
    return nextResolve(specifier, context);
  }

  const base = path.join(srcRoot, specifier.slice(2));
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = base + suffix;
    if (existsSync(candidate)) {
      return nextResolve(pathToFileURL(candidate).href, context);
    }
  }

  throw new Error(`Could not resolve "${specifier}" under ${srcRoot}`);
}

/** JSON values accepted by the provider-neutral counterexample shrinker. */
export type ShrinkableJson =
  | null
  | boolean
  | number
  | string
  | ShrinkableJson[]
  | { [key: string]: ShrinkableJson };

export interface ShrinkOptions {
  /** Maximum predicate calls, including candidates rejected by the predicate. */
  max_attempts?: number;
  /** Maximum accepted reductions. */
  max_reductions?: number;
  /** Maximum JSON depth accepted by the boundary. */
  max_depth?: number;
  /** Maximum serialized input/candidate size in bytes. */
  max_bytes?: number;
}

export interface ShrinkResult<T extends ShrinkableJson> {
  value: T;
  attempts: number;
  reductions: number;
  complete: boolean;
}

export type FailurePredicate<T extends ShrinkableJson> = (
  candidate: T,
) => boolean | Promise<boolean>;

const DEFAULT_MAX_ATTEMPTS = 500;
const DEFAULT_MAX_REDUCTIONS = 100;
const DEFAULT_MAX_DEPTH = 32;
const DEFAULT_MAX_BYTES = 1_000_000;

/**
 * Minimize a JSON counterexample while preserving a caller-owned failure
 * predicate. The predicate is the only execution boundary: this package never
 * executes commands, sends HTTP requests, logs candidate values or mutates the
 * system under test. The result is locally minimal for the bounded candidate
 * ordering, not a claim of global mathematical minimality.
 */
export async function shrinkJsonCounterexample<T extends ShrinkableJson>(
  input: T,
  fails: FailurePredicate<T>,
  options: ShrinkOptions = {},
): Promise<ShrinkResult<T>> {
  const limits = normalizeLimits(options);
  assertJsonBoundary(input, limits.max_depth, limits.max_bytes);
  let current = input;
  let attempts = 0;
  let reductions = 0;

  while (attempts < limits.max_attempts && reductions < limits.max_reductions) {
    let accepted = false;
    for (const candidate of candidates(current, limits.max_depth)) {
      if (attempts >= limits.max_attempts) break;
      attempts += 1;
      assertJsonBoundary(candidate, limits.max_depth, limits.max_bytes);
      if (await fails(candidate as T)) {
        current = candidate as T;
        reductions += 1;
        accepted = true;
        break;
      }
    }
    if (!accepted) break;
  }

  return {
    value: current,
    attempts,
    reductions,
    complete: attempts < limits.max_attempts && reductions < limits.max_reductions,
  };
}

function normalizeLimits(options: ShrinkOptions): Required<ShrinkOptions> {
  return {
    max_attempts: positiveLimit(options.max_attempts, DEFAULT_MAX_ATTEMPTS, 'max_attempts'),
    max_reductions: positiveLimit(options.max_reductions, DEFAULT_MAX_REDUCTIONS, 'max_reductions'),
    max_depth: positiveLimit(options.max_depth, DEFAULT_MAX_DEPTH, 'max_depth'),
    max_bytes: positiveLimit(options.max_bytes, DEFAULT_MAX_BYTES, 'max_bytes'),
  };
}

function positiveLimit(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`shrinker ${name} must be positive`);
  return value;
}

function assertJsonBoundary(value: ShrinkableJson, maxDepth: number, maxBytes: number): void {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('shrinker input must be JSON serializable');
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes)
    throw new Error('shrinker input exceeds max_bytes');
  if (depth(value) > maxDepth) throw new Error('shrinker input exceeds max_depth');
}

function depth(value: ShrinkableJson): number {
  if (!Array.isArray(value) && !isObject(value)) return 0;
  const children = Array.isArray(value) ? value : Object.values(value);
  return children.length === 0 ? 1 : 1 + Math.max(...children.map(depth));
}

function candidates(value: ShrinkableJson, maxDepth: number): ShrinkableJson[] {
  const result: ShrinkableJson[] = [];
  if (typeof value === 'string') {
    if (value.length > 0) result.push('');
    if (value.length > 1) result.push(value.slice(0, Math.ceil(value.length / 2)));
  } else if (typeof value === 'number' && Number.isFinite(value) && value !== 0) {
    result.push(0);
    result.push(Math.trunc(value / 2));
  } else if (typeof value === 'boolean' && value) {
    result.push(false);
  } else if (Array.isArray(value)) {
    for (const chunk of removalChunks(value.length))
      result.push(value.filter((_item, index) => !chunk.has(index)));
    if (value.length > 0 && maxDepth > 0)
      for (let index = 0; index < value.length; index += 1)
        for (const child of candidates(value[index] ?? null, maxDepth - 1)) {
          const copy = value.slice();
          copy[index] = child;
          result.push(copy);
        }
  } else if (isObject(value)) {
    const keys = Object.keys(value).sort();
    for (const key of keys) {
      const copy = { ...value };
      delete copy[key];
      result.push(copy);
    }
    if (maxDepth > 0)
      for (const key of keys)
        for (const child of candidates(value[key] ?? null, maxDepth - 1))
          result.push({ ...value, [key]: child });
  }
  return result;
}

function removalChunks(length: number): Set<number>[] {
  const result: Set<number>[] = [];
  for (let size = length; size >= 1; size = Math.floor(size / 2)) {
    for (let start = 0; start + size <= length; start += size)
      result.push(new Set(Array.from({ length: size }, (_item, index) => start + index)));
    if (size === 1) break;
  }
  return result;
}

function isObject(value: ShrinkableJson): value is { [key: string]: ShrinkableJson } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

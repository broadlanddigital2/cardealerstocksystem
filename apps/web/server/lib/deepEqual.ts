// Deep, strict equality for the plain data the accounting code compares
// (records from the database and request bodies): primitives, arrays, plain
// objects, Dates. Used instead of node:util's isDeepStrictEqual so the result
// doesn't depend on the Workers runtime's Node compatibility layer.
export function isDeepStrictEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (a instanceof Date) return a.getTime() === (b as Date).getTime();
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => isDeepStrictEqual(v, bb[i]));
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) => Object.prototype.hasOwnProperty.call(b, k) && isDeepStrictEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

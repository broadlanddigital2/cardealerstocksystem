import { describe, expect, it } from "vitest";
import { isDeepStrictEqual as node } from "node:util";
import { isDeepStrictEqual } from "../lib/deepEqual";

describe("isDeepStrictEqual", () => {
  const cases: [unknown, unknown][] = [
    [1, 1], [1, "1"], [NaN, NaN], [0, -0], [null, undefined], ["a", "a"],
    [{ a: 1, b: [1, { c: "x" }] }, { b: [1, { c: "x" }], a: 1 }],
    [{ a: 1 }, { a: 1, b: undefined }], [[1, 2], [1, 2]], [[1, 2], [2, 1]],
    [new Date(5), new Date(5)], [new Date(5), new Date(6)], [{ d: new Date(1) }, { d: new Date(1) }],
    [{ a: "100.00" }, { a: "100" }], [[], {}],
  ];
  it("agrees with Node for the data the accounting code compares", () => {
    for (const [a, b] of cases) expect(isDeepStrictEqual(a, b)).toBe(node(a, b));
  });
});

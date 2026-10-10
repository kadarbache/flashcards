import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shuffled } from "@/lib/shuffle";

describe("shuffled", () => {
  it("keeps every item exactly once", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    assert.deepEqual([...shuffled(items)].sort(), items);
  });

  it("leaves the original array alone", () => {
    const items = ["a", "b", "c", "d"];
    shuffled(items);
    assert.deepEqual(items, ["a", "b", "c", "d"]);
  });

  it("follows the random source it is given", () => {
    // A source stuck at zero always swaps with the first slot, which rotates
    // the list one place to the left.
    assert.deepEqual(shuffled([1, 2, 3, 4], () => 0), [2, 3, 4, 1]);
  });

  it("actually reorders", () => {
    const items = Array.from({ length: 20 }, (_, index) => index);
    const orders = new Set<string>();
    for (let run = 0; run < 20; run++) orders.add(shuffled(items).join(","));
    assert.ok(orders.size > 1, "twenty shuffles all came out identical");
  });

  it("copes with nothing and with one", () => {
    assert.deepEqual(shuffled([]), []);
    assert.deepEqual(shuffled(["only"]), ["only"]);
  });
});

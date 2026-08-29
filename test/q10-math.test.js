import assert from "node:assert/strict";
import test from "node:test";

import { calculateQ10Requirements } from "../public/q10-math.js";

const components = (...ids) => ids.map((id) => ({ id }));

test("calculates the required average and per-piece floor for missing components", () => {
  const result = calculateQ10Requirements(
    components("a", "b", "c", "d"),
    ["a"],
    { a: 10 },
  );

  assert.equal(result.status, "in-progress");
  assert.equal(result.requiredRemainingAverage, 28 / 3);
  assert.equal(result.minimumQualityIfOthersTen, 8);
});

test("detects when a Q10 result is impossible", () => {
  const result = calculateQ10Requirements(
    components("a", "b"),
    ["a"],
    { a: 8 },
  );

  assert.equal(result.status, "impossible");
  assert.equal(result.requiredRemainingAverage, 11);
  assert.equal(result.minimumQualityIfOthersTen, 11);
});

test("requires quality values for legacy checked components", () => {
  const result = calculateQ10Requirements(
    components("a", "b"),
    ["a"],
    {},
  );

  assert.equal(result.status, "needs-quality");
  assert.equal(result.unknownFoundCount, 1);
});

test("recognizes final averages at and below the Q10 threshold", () => {
  const achieved = calculateQ10Requirements(
    components("a", "b"),
    ["a", "b"],
    { a: 10, b: 9 },
  );
  const missed = calculateQ10Requirements(
    components("a", "b"),
    ["a", "b"],
    { a: 9, b: 9 },
  );

  assert.equal(achieved.status, "achieved");
  assert.equal(achieved.finalAverage, 9.5);
  assert.equal(missed.status, "missed");
  assert.equal(missed.finalAverage, 9);
});

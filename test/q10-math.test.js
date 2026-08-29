import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateQ10Requirements,
  calculateSetRequirements,
  evaluateComponent,
} from "../public/q10-math.js";

const components = (...ids) => ids.map((id) => ({ id, type: "item" }));

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

test("a nested assembled set contributes one rounded quality to its parent", () => {
  const mashedPotatoes = {
    id: "mashed",
    name: "Mashed Potatoes",
    type: "set",
    components: components("potato", "peeler"),
  };
  const deliciousMeal = {
    id: "meal",
    name: "Delicious Meal",
    type: "set",
    components: [
      { id: "steak", type: "item" },
      mashedPotatoes,
    ],
  };
  const collected = ["potato", "peeler", "steak"];
  const qualities = { potato: 10, peeler: 9, steak: 9 };

  const mashedResult = evaluateComponent(mashedPotatoes, collected, qualities);
  const mealResult = calculateSetRequirements(deliciousMeal, collected, qualities, 10);

  assert.equal(mashedResult.average, 9.5);
  assert.equal(mashedResult.quality, 10);
  assert.equal(mealResult.totalCount, 2);
  assert.equal(mealResult.knownQualitySum, 19);
  assert.equal(mealResult.finalAverage, 9.5);
  assert.equal(mealResult.resultQuality, 10);
  assert.equal(mealResult.status, "achieved");
});

test("quality resolves recursively through multiple assembled-set levels", () => {
  const mashed = {
    id: "mashed",
    type: "set",
    components: components("potato", "peeler"),
  };
  const delicious = {
    id: "delicious",
    type: "set",
    components: [{ id: "steak", type: "item" }, mashed],
  };
  const warm = {
    id: "warm",
    type: "set",
    components: [{ id: "hotplate", type: "item" }, delicious],
  };
  const collected = ["potato", "peeler", "steak", "hotplate"];
  const qualities = { potato: 10, peeler: 9, steak: 9, hotplate: 10 };

  const result = evaluateComponent(warm, collected, qualities);

  assert.equal(result.childEvaluations[1].evaluation.quality, 10);
  assert.equal(result.childEvaluations[1].evaluation.childEvaluations[1].evaluation.quality, 10);
  assert.equal(result.average, 10);
  assert.equal(result.quality, 10);
});

test("a nested set receives the parent component quality target", () => {
  const childSet = {
    id: "child",
    type: "set",
    components: components("a", "b", "c"),
  };
  const childPlan = calculateSetRequirements(childSet, ["a"], { a: 9 }, 9);

  assert.equal(childPlan.targetAverage, 8.5);
  assert.equal(childPlan.requiredRemainingAverage, 8.25);
  assert.equal(childPlan.minimumQualityIfOthersTen, 7);
});

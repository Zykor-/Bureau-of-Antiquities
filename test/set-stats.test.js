import assert from "node:assert/strict";
import test from "node:test";

import { formatSetStats } from "../public/set-stats.js";

const assembled = {
  difficulty: 6.64,
  q5Attack: 95,
  q5Defense: 101,
  q10Attack: 245,
  q10Defense: 245,
};

test("formats Q5 and Q10 comparison stats from the selected assembled item", () => {
  assert.equal(formatSetStats(assembled, false), "Difficulty: 6.64 / 10 · Q5 95 ATK / 101 DEF");
  assert.equal(formatSetStats(assembled, true), "Difficulty: 6.64 / 10 · Q10 245 ATK / 245 DEF");
});

test("omits missing difficulty and individual combat stats without placeholders", () => {
  assert.equal(formatSetStats({ q5Attack: 80 }, false), "Q5 80 ATK");
  assert.equal(formatSetStats({ difficulty: 9.05, q10Defense: 210 }, true), "Difficulty: 9.05 / 10 · Q10 210 DEF");
  assert.equal(formatSetStats({}, false), "");
});

